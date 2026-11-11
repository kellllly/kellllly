import { randomUUID } from "node:crypto";
import { sanitizeAttachment } from "./itsm-attachments.ts";
import { ItsmAuthorizationError, requirePermission, type ItsmActor } from "./itsm-rbac.ts";
import { developmentRoleArchiveConfig, developmentRoleArchiveEnabled } from "./development-role-archive-config.ts";
import { isKeptWholeAuditType, isPrunedAuditEvent, pruneAuditEvent, sealAuditEvents, stripAuditChainFields } from "./itsm-audit-chain.ts";
import {
  findNewSlaBreaches, findSlaEscalations, ITSM_SLA_ESCALATION_AUDIT_TYPE, SLA_MONITOR_ACTOR,
  slaBreachAuditEvent, type SlaBreach, type SlaEscalation,
} from "./itsm-sla.ts";

export type WorkspaceActor = ItsmActor;
type JsonRecord = Record<string, unknown>;

const PRIORITY: Record<string, string[]> = {
  "1": ["P1", "P2", "P3"],
  "2": ["P2", "P3", "P3"],
  "3": ["P3", "P3", "P4"],
};
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  Nouveau: ["Pris en compte", "Rejeté"],
  "Pris en compte": ["En cours", "En attente", "Résolu"],
  "En cours": ["En attente", "Résolu"],
  "En attente": ["En cours", "Résolu"],
  Résolu: ["En cours", "Clos"],
  Clos: [],
  Rejeté: [],
};
const TICKET_FIELDS = [
  "title", "kind", "category", "impact", "urgency", "supportLevel", "assignee",
  "serviceId", "assetId", "description", "rootCause", "resolution", "cab",
  "conversationId", "sourceMessageId",
] as const;
/** Standard requests acknowledged at creation (CDC-ANIF-MSG-2025 §6.5): template id → required category. Mirrors REQUEST_TEMPLATES in the front. */
const AUTO_APPROVED_REQUESTS = new Map([["mot-de-passe", "Accès"]]);
const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const records = (value: unknown) => Array.isArray(value) ? value.filter(isRecord) : [];
const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalJson(item)]),
    );
  }
  return value;
};
const jsonEqual = (a: unknown, b: unknown) => JSON.stringify(canonicalJson(a)) === JSON.stringify(canonicalJson(b));
const newStamp = (now: Date) => now.toISOString();
export const ITSM_ROLE_CHANGE_AUDIT_TYPE = "itsm.role.changed";
export const ITSM_ROLE_ATTESTATION_AUDIT_TYPE = "itsm.role.attested";
export const ITSM_ROLE_AUDIT_TYPES = [
  ITSM_ROLE_CHANGE_AUDIT_TYPE,
  ITSM_ROLE_ATTESTATION_AUDIT_TYPE,
] as const;
export const ITSM_TICKET_CONVERSION_AUDIT_TYPE = "itsm.ticket.converted";
const MAX_NON_ROLE_AUDIT_EVENTS = 5000;
/**
 * Seal new journal events into the hash chain, then keep at most 5,000 ordinary
 * events with their content. Older ordinary events become pruned stubs that keep
 * only their seal, so the chain stays verifiable. Authorization events are kept whole.
 */
function retainItsmAuditEvents(events: unknown): JsonRecord[] {
  let retainedNonRoleEvents = 0;
  return sealAuditEvents(records(events)).map((event) => {
    if (isPrunedAuditEvent(event)) return event;
    if (isKeptWholeAuditType(event.type)) return event;
    retainedNonRoleEvents += 1;
    return retainedNonRoleEvents <= MAX_NON_ROLE_AUDIT_EVENTS ? event : pruneAuditEvent(event);
  });
}
/**
 * Seal a stored journal that has events without a seal (journal written before
 * the hash chain existed). Returns null when there is nothing to seal.
 */
/**
 * Opens the general announcements channel and the support services room once,
 * so N4 accounts have their two spaces from the start. Only for a workspace that
 * already has conversations: a fresh one keeps the browser's demonstration seed.
 */
export const SUPPORT_SERVICE_CHANNELS = [
  { id: "C-ANN", title: "Annonces générales", kind: "Annonce", body: "Canal d’annonces de la Direction : notes de service, fermetures, rappels de sécurité. Publication réservée aux comptes N1." },
  { id: "C-ADM", title: "Services d’appui — coordination", kind: "Administratif", body: "Salon administratif ouvert aux services d’appui (secrétariat, ressources humaines, comptabilité, logistique) et aux autres services. Aucun contenu d’enquête." },
] as const;

export function ensureSupportServiceChannels(store: JsonRecord, now = new Date()): JsonRecord | null {
  if (!Array.isArray(store.conversations)) return null;
  const existing = new Set(records(store.conversations).map((conversation) => String(conversation.id)));
  const missing = SUPPORT_SERVICE_CHANNELS.filter((channel) => !existing.has(channel.id));
  if (!missing.length) return null;
  const created = missing.map((channel) => ({
    id: channel.id, title: channel.title, kind: channel.kind, classification: "Interne",
    participants: [channel.kind === "Annonce" ? "Direction" : "Services d’appui"], readCount: 0,
    messages: [{ id: randomUUID(), author: "Direction", body: channel.body, system: true, at: newStamp(now), time: shortTime(now) }],
  }));
  return { ...store, conversations: [...created, ...records(store.conversations)] };
}

export function sealItsmWorkspaceAudit(store: JsonRecord): JsonRecord | null {
  const audit = records(store.audit);
  if (!audit.some((event) => !isPrunedAuditEvent(event) && typeof event.hash !== "string")) return null;
  return { ...store, audit: retainItsmAuditEvents(audit) };
}
const shortTime = (now: Date) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Libreville", hour: "2-digit", minute: "2-digit",
}).format(now);

/**
 * Journal each SLA breach not recorded yet and apply the escalation circuit
 * (see lib/itsm-sla.ts): notifications, P2 reassignment, P4 reminder.
 */
export function recordItsmSlaBreaches(store: JsonRecord, now = new Date()): {
  store: JsonRecord; breaches: SlaBreach[]; escalations: SlaEscalation[];
} {
  const breaches = findNewSlaBreaches(store.tickets, store.audit, now);
  const escalations = findSlaEscalations(store.tickets, store.audit, now);
  if (breaches.length === 0 && escalations.length === 0) return { store, breaches, escalations };
  const at = newStamp(now);
  const time = shortTime(now);
  const events: JsonRecord[] = breaches.map((breach) => slaBreachAuditEvent(breach, randomUUID(), at, time));
  const notifications: JsonRecord[] = [];
  const tickets = records(store.tickets).map((ticket) => ({ ...ticket }));
  for (const escalation of escalations) {
    events.push({
      id: randomUUID(),
      type: ITSM_SLA_ESCALATION_AUDIT_TYPE,
      action: escalation.title,
      actor: SLA_MONITOR_ACTOR,
      scope: `Ticket ${escalation.ticketId}`,
      ticketId: escalation.ticketId,
      rule: escalation.rule,
      escalationKey: escalation.key,
      priority: escalation.priority,
      recipients: escalation.recipients,
      at,
      time,
    });
    notifications.push({ id: randomUUID(), ticketId: escalation.ticketId, title: escalation.title, body: `${escalation.body} Destinataires : ${escalation.recipients}.`, at });
    const ticket = tickets.find((item) => item.id === escalation.ticketId);
    if (!ticket) continue;
    const history = escalation.reassign
      ? `Escalade automatique : réaffecté de ${String(ticket.assignee ?? "—")} à ${escalation.reassign.assignee} (L${escalation.reassign.supportLevel}).`
      : escalation.ticketUpdate;
    if (escalation.reassign) Object.assign(ticket, escalation.reassign);
    if (history) {
      ticket.updates = [...records(ticket.updates), { author: SLA_MONITOR_ACTOR, body: history, at, time }];
    }
  }
  return {
    store: {
      ...store,
      tickets,
      notifications: [...notifications, ...records(store.notifications)],
      audit: retainItsmAuditEvents([...events, ...records(store.audit)]),
    },
    breaches,
    escalations,
  };
}

export type ItsmRoleChangeAuditDetails = {
  actorId: string;
  targetUserId: string;
  previousRole: string | null;
  nextRole: string | null;
  previousServiceIds: string[];
  serviceIds: string[];
  scope: string;
  origin?: "bootstrap";
};

export type ItsmRoleChangeArchiveEvent = {
  id: string;
  type: typeof ITSM_ROLE_CHANGE_AUDIT_TYPE | typeof ITSM_ROLE_ATTESTATION_AUDIT_TYPE;
  actor: string;
  targetUserId: string;
  previousRole: string | null;
  nextRole: string | null;
  previousServiceIds: string[];
  serviceIds: string[];
  scope: string;
  at: string;
  origin?: "bootstrap";
};

export type ItsmRoleSnapshot = {
  id: string;
  role: string | null;
  serviceIds: string[];
};

export type ItsmRoleReconciliationFinding = {
  userId: string;
  reason: "missing_audit" | "role_mismatch" | "scope_mismatch";
  clerkRole: string;
  clerkServiceIds: string[];
  auditRole: string | null;
  auditServiceIds: string[];
};

export function findItsmRoleReconciliationIssues(
  clerkAccounts: ItsmRoleSnapshot[],
  auditEvents: unknown,
): ItsmRoleReconciliationFinding[] {
  const latestByUser = new Map<string, { event: JsonRecord; timestamp: number }>();
  for (const event of records(auditEvents)) {
    if (!ITSM_ROLE_AUDIT_TYPES.includes(event.type as typeof ITSM_ROLE_AUDIT_TYPES[number])
      || typeof event.targetUserId !== "string") continue;
    const timestamp = typeof event.at === "string" ? Date.parse(event.at) : Number.NaN;
    const existing = latestByUser.get(event.targetUserId);
    if (!existing || (Number.isFinite(timestamp) && (!Number.isFinite(existing.timestamp) || timestamp > existing.timestamp))) {
      latestByUser.set(event.targetUserId, { event, timestamp });
    }
  }

  const normalizeIds = (ids: unknown) => [...new Set(
    Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [],
  )].sort();
  const findings: ItsmRoleReconciliationFinding[] = [];
  for (const account of clerkAccounts) {
    if (typeof account.role !== "string" || !account.role) continue;
    const clerkServiceIds = normalizeIds(account.serviceIds);
    const latest = latestByUser.get(account.id)?.event;
    if (!latest) {
      // Missing evidence does not identify the source of the Clerk role; do not infer bootstrap or manual change.
      findings.push({
        userId: account.id,
        reason: "missing_audit",
        clerkRole: account.role,
        clerkServiceIds,
        auditRole: null,
        auditServiceIds: [],
      });
      continue;
    }
    const auditRole = typeof latest.nextRole === "string" ? latest.nextRole : null;
    const auditServiceIds = normalizeIds(latest.serviceIds);
    if (account.role !== auditRole) {
      findings.push({
        userId: account.id,
        reason: "role_mismatch",
        clerkRole: account.role,
        clerkServiceIds,
        auditRole,
        auditServiceIds,
      });
    } else if (!jsonEqual(clerkServiceIds, auditServiceIds)) {
      findings.push({
        userId: account.id,
        reason: "scope_mismatch",
        clerkRole: account.role,
        clerkServiceIds,
        auditRole,
        auditServiceIds,
      });
    }
  }
  return findings;
}

export const ITSM_ROLE_RECONCILIATION_ALERT = "itsm_role_reconciliation_mismatch";
export const ITSM_ROLE_RECONCILIATION_RECOVERED_ALERT = "itsm_role_reconciliation_recovered";

export function createItsmRoleReconciliationMonitor(options: {
  scan: () => Promise<ItsmRoleReconciliationFinding[]>;
  logger: Pick<import("pino").Logger, "error" | "info">;
  intervalMs?: number;
}) {
  let lastSignature = "";
  let checkInProgress = false;
  let timer: NodeJS.Timeout | undefined;

  const checkNow = async (): Promise<void> => {
    if (checkInProgress) return;
    checkInProgress = true;
    try {
      const findings = await options.scan();
      const signature = JSON.stringify(findings.map((finding) => [
        finding.userId, finding.reason, finding.clerkRole, finding.clerkServiceIds,
        finding.auditRole, finding.auditServiceIds,
      ]));
      if (signature && signature !== "[]") {
        if (signature !== lastSignature) {
          options.logger.error({
            alert: ITSM_ROLE_RECONCILIATION_ALERT,
            component: "itsm_role_reconciliation",
            status: "mismatch",
            source: "periodic_health_check",
            findings,
          }, "ITSM_ROLE_RECONCILIATION_MISMATCH");
        }
      } else if (lastSignature) {
        options.logger.info({
          alert: ITSM_ROLE_RECONCILIATION_RECOVERED_ALERT,
          component: "itsm_role_reconciliation",
          status: "consistent",
          source: "periodic_health_check",
        }, "ITSM_ROLE_RECONCILIATION_RECOVERED");
      }
      lastSignature = signature === "[]" ? "" : signature;
    } catch (error) {
      options.logger.error({
        err: error,
        alert: ITSM_ROLE_RECONCILIATION_ALERT,
        component: "itsm_role_reconciliation",
        status: "check_failed",
        source: "periodic_health_check",
      }, "ITSM_ROLE_RECONCILIATION_CHECK_FAILED");
    } finally {
      checkInProgress = false;
    }
  };

  return {
    checkNow,
    start(): void {
      if (timer) return;
      void checkNow();
      timer = setInterval(() => void checkNow(), options.intervalMs ?? 60_000);
      timer.unref();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

export class ItsmRoleArchiveUnavailableError extends Error {
  constructor(message = "L’archive des habilitations n’a pas confirmé la réception.") {
    super(message);
    this.name = "ItsmRoleArchiveUnavailableError";
  }
}

export function isDevelopmentDatabaseRoleArchiveEnabled(): boolean {
  if (process.env.ITSM_ROLE_ARCHIVE_MODE !== "development-db") return false;
  if (process.env.NODE_ENV !== "development") {
    throw new ItsmRoleArchiveUnavailableError(
      "L’archive locale des habilitations est réservée à l’environnement de développement.",
    );
  }
  return true;
}

function getItsmRoleArchiveConfig(options: {
  url?: string;
  token?: string;
} = {}): { endpoint: URL; headers: Record<string, string> } {
  if (options.url === undefined && developmentRoleArchiveEnabled()) {
    return developmentRoleArchiveConfig();
  }
  const archiveUrl = options.url ?? process.env.ITSM_ROLE_ARCHIVE_URL;
  if (!archiveUrl) {
    throw new ItsmRoleArchiveUnavailableError("L’URL de l’archive n’est pas configurée.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(archiveUrl);
  } catch {
    throw new ItsmRoleArchiveUnavailableError("L’URL de l’archive est invalide.");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new ItsmRoleArchiveUnavailableError(
      "L’URL de l’archive doit être une adresse HTTPS valide sans identifiants intégrés.",
    );
  }

  const token = options.token ?? process.env.ITSM_ROLE_ARCHIVE_TOKEN;
  return {
    endpoint,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  };
}

export async function checkItsmRoleArchiveConnection(
  options: {
    url?: string;
    token?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  // Development-db mode: the archive is written in the same PostgreSQL
  // transaction as the journal, so there is no remote receiver to reach.
  if (options.url === undefined && isDevelopmentDatabaseRoleArchiveEnabled()) return;
  const { endpoint, headers } = getItsmRoleArchiveConfig(options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "HEAD",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      const methodHint = response.status === 405
        ? " (la méthode HEAD n’est pas prise en charge par l’archive)"
        : "";
      throw new ItsmRoleArchiveUnavailableError(
        `L’archive a répondu avec HTTP ${response.status}${methodHint}.`,
      );
    }
  } catch (error) {
    if (error instanceof ItsmRoleArchiveUnavailableError) throw error;
    throw new ItsmRoleArchiveUnavailableError(
      controller.signal.aborted
        ? "Le contrôle de l’archive a dépassé le délai autorisé."
        : "Connexion impossible à l’archive; vérifiez son URL et sa disponibilité.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function publishItsmRoleChangeToArchive(
  event: ItsmRoleChangeArchiveEvent,
  options: {
    url?: string;
    token?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  if (isDevelopmentDatabaseRoleArchiveEnabled()) {
    // In this explicit development-only mode, the caller persists this event
    // in the workspace audit within the same PostgreSQL transaction.
    return;
  }
  const { endpoint, headers: authHeaders } = getItsmRoleArchiveConfig(options);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": event.id,
        ...authHeaders,
      },
      body: JSON.stringify({
        schemaVersion: 1,
        source: "anif-secure-desk",
        event,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new ItsmRoleArchiveUnavailableError();
  } catch {
    throw new ItsmRoleArchiveUnavailableError();
  } finally {
    clearTimeout(timeout);
  }
}

export function recordItsmRoleChange(
  current: JsonRecord,
  details: ItsmRoleChangeAuditDetails,
  now = new Date(),
): JsonRecord {
  const next = structuredClone(current);
  const event = {
    id: randomUUID(),
    type: ITSM_ROLE_CHANGE_AUDIT_TYPE,
    action: details.origin === "bootstrap"
      ? "Première habilitation N1 attribuée par bootstrap"
      : details.nextRole ? "Habilitation modifiée" : "Habilitation retirée",
    ...(details.origin ? { origin: details.origin } : {}),
    actor: details.actorId,
    targetUserId: details.targetUserId,
    previousRole: details.previousRole,
    nextRole: details.nextRole,
    previousServiceIds: [...details.previousServiceIds],
    serviceIds: [...details.serviceIds],
    scope: details.scope,
    at: newStamp(now),
    time: shortTime(now),
  };
  // Keep every authorization event; the 5,000-entry limit applies to other events.
  next.audit = retainItsmAuditEvents([event, ...records(next.audit)]);
  return next;
}

export function recordItsmRoleAttestation(
  current: JsonRecord,
  details: {
    actorId: string;
    targetUserId: string;
    role: string;
    serviceIds: string[];
    scope: string;
  },
  now = new Date(),
): JsonRecord {
  const next = structuredClone(current);
  const event = {
    id: randomUUID(),
    type: ITSM_ROLE_ATTESTATION_AUDIT_TYPE,
    action: "Rôle ITSM vérifié (attestation)",
    actor: details.actorId,
    targetUserId: details.targetUserId,
    previousRole: details.role,
    nextRole: details.role,
    previousServiceIds: [...details.serviceIds],
    serviceIds: [...details.serviceIds],
    scope: details.scope,
    at: newStamp(now),
    time: shortTime(now),
  };
  next.audit = retainItsmAuditEvents([event, ...records(next.audit)]);
  return next;
}

/** Journal an RFC 3161 timestamp of the Merkle checkpoint of the first `size` events. */
export function recordItsmAuditTimestamp(
  current: JsonRecord,
  details: {
    actorId: string;
    size: number;
    root: string;
    tsaUrl: string;
    token: string;
    genTime: string | null;
    serial: string | null;
    policy: string | null;
    tsaSubject: string | null;
  },
  now = new Date(),
): JsonRecord {
  const next = structuredClone(current);
  const event = {
    id: randomUUID(),
    type: "itsm.audit.timestamped",
    action: `Point de contrôle du journal horodaté (RFC 3161, ${details.size} événements)`,
    actor: details.actorId,
    scope: "Journal",
    checkpoint: { size: details.size, root: details.root },
    tsa: { url: details.tsaUrl, subject: details.tsaSubject, genTime: details.genTime, serial: details.serial, policy: details.policy },
    token: details.token,
    at: newStamp(now),
    time: shortTime(now),
  };
  next.audit = retainItsmAuditEvents([event, ...records(next.audit)]);
  return next;
}

function ticketPrefix(kind: unknown): string {
  if (kind === "Demande") return "REQ";
  if (kind === "Problème") return "PRB";
  if (kind === "Changement") return "CHG";
  return "INC";
}

function nextTicketId(kind: unknown, tickets: JsonRecord[]): string {
  const prefix = ticketPrefix(kind);
  const max = tickets.reduce((highest, ticket) => {
    const match = String(ticket.id ?? "").match(/(\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 2400);
  return `${prefix}-${max + 1}`;
}

function eventFor(ticket: JsonRecord, body: string, actor: WorkspaceActor, now: Date) {
  const at = newStamp(now);
  return {
    ...ticket,
    updates: [
      ...records(ticket.updates),
      { author: actor.id, body, at, time: shortTime(now) },
    ],
  };
}

function validateTicketBasics(ticket: JsonRecord): string | null {
  if (typeof ticket.title !== "string" || !ticket.title.trim() || ticket.title.length > 180) return "Le sujet du ticket est obligatoire (180 caractères maximum).";
  if (!["Incident", "Demande", "Problème", "Changement"].includes(String(ticket.kind))) return "Type de ticket invalide.";
  if (![1, 2, 3].includes(Number(ticket.impact)) || ![1, 2, 3].includes(Number(ticket.urgency))) return "Impact ou urgence invalide.";
  if (![1, 2, 3].includes(Number(ticket.supportLevel))) return "Niveau de support invalide.";
  if (!PRIORITY[String(ticket.impact)]?.[Number(ticket.urgency) - 1]) return "Qualification de priorité invalide.";
  if (typeof ticket.description !== "string" || ticket.description.length > 12_000) return "Description invalide (12 000 caractères maximum).";
  if (!["Applications", "Poste de travail", "Équipement", "Réseau", "Accès"].includes(String(ticket.category))) return "Catégorie invalide.";
  if (typeof ticket.assignee !== "string" || ticket.assignee.length > 120) return "Assignation invalide.";
  return null;
}

function importMerge(current: JsonRecord, source: JsonRecord, actor: WorkspaceActor, now: Date): JsonRecord {
  const merged = structuredClone(current);
  const importedConversations = records(source.conversations);
  const currentConversations = records(merged.conversations);
  const conversationIds = new Set(currentConversations.map((item) => String(item.id)));
  const remap = new Map<string, string>();
  for (const incoming of importedConversations) {
    const id = String(incoming.id ?? "");
    if (!id || conversationIds.has(id)) {
      const existing = currentConversations.find((item) => item.id === id);
      if (existing && existing.title === incoming.title && existing.kind === incoming.kind
        && JSON.stringify(records(existing.messages).map((message) => message.body))
          === JSON.stringify(records(incoming.messages).map((message) => message.body))) continue;
      if (!id) continue;
      const suffix = actor.id.replace(/[^a-zA-Z0-9]/g, "").slice(-6) || "member";
      let candidate = `${id}-IMP-${suffix}`;
      let n = 2;
      while (conversationIds.has(candidate)) candidate = `${id}-IMP-${suffix}-${n++}`;
      remap.set(id, candidate);
      incoming.id = candidate;
    }
    conversationIds.add(String(incoming.id));
    currentConversations.push(incoming);
  }
  merged.conversations = currentConversations;

  const currentTickets = records(merged.tickets);
  const ticketIds = new Set(currentTickets.map((item) => String(item.id)));
  for (const incoming of records(source.tickets)) {
    let id = String(incoming.id ?? "");
    if (!id) continue;
    const existing = currentTickets.find((item) => item.id === id);
    if (existing) {
      if (existing.title === incoming.title && existing.kind === incoming.kind
        && existing.description === incoming.description) continue;
      const suffix = actor.id.replace(/[^a-zA-Z0-9]/g, "").slice(-6) || "member";
      let candidate = `${id}-IMP-${suffix}`;
      let n = 2;
      while (ticketIds.has(candidate)) candidate = `${id}-IMP-${suffix}-${n++}`;
      id = candidate;
    }
    const { requesterId: _legacyRequesterId, ...legacyTicket } = incoming;
    const copy = { ...legacyTicket, id, conversationId: remap.get(String(incoming.conversationId ?? "")) ?? incoming.conversationId };
    ticketIds.add(id);
    currentTickets.unshift(copy);
  }
  merged.tickets = currentTickets;

  for (const collection of ["audit", "kedb", "notifications"] as const) {
    const currentItems = records(merged[collection]);
    const ids = new Set(currentItems.map((item) => String(item.id)));
    for (const item of records(source[collection])) {
      if (collection === "audit" && ITSM_ROLE_AUDIT_TYPES.includes(item.type as typeof ITSM_ROLE_AUDIT_TYPES[number])) continue;
      const id = String(item.id ?? "");
      if (id && !ids.has(id)) {
        currentItems.push(collection === "audit" ? stripAuditChainFields(item) : item);
        ids.add(id);
      }
    }
    merged[collection] = currentItems;
  }
  const at = newStamp(now);
  merged.audit = retainItsmAuditEvents([{
    id: randomUUID(), action: "Exemples locaux importés sans écraser les données partagées",
    actor: actor.id, scope: "Espace ITSM", at, time: shortTime(now),
  }, ...records(merged.audit)]);
  merged.services = Array.isArray(current.services) ? current.services : records(source.services);
  merged.assets = Array.isArray(current.assets) ? current.assets : records(source.assets);
  merged.seeded = Array.isArray(source.seeded) ? source.seeded : [];
  merged.schema = source.schema ?? 2;
  return merged;
}

/** Ephemeral messages (cahier des charges, messagerie) : 30 s to 30 days. */
export const MIN_MESSAGE_TTL_SECONDS = 30;
export const MAX_MESSAGE_TTL_SECONDS = 30 * 24 * 60 * 60;
const EPHEMERAL_PURGE_AUDIT_TYPE = "itsm.messages.expired";

function messageExpiry(message: JsonRecord, now: Date): JsonRecord {
  const { ttlSeconds, expiresAt: _clientExpiry, expired: _clientExpired, attachment: rawAttachment, ...base } = message;
  const attachment = sanitizeAttachment(rawAttachment);
  const rest = attachment ? { ...base, attachment } : base;
  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) return rest;
  const seconds = Math.round(Math.min(MAX_MESSAGE_TTL_SECONDS, Math.max(MIN_MESSAGE_TTL_SECONDS, ttl)));
  return { ...rest, ttlSeconds: seconds, expiresAt: new Date(now.getTime() + seconds * 1000).toISOString() };
}

/**
 * The only fields a browser may set on a new message; author, identifier and
 * times are the server's. System notices (ticket follow-up) are written by the
 * server only: a client copy of one is dropped, so nobody can post an official-
 * looking notice without an author.
 */
function clientMessage(message: JsonRecord, actor: WorkspaceActor, now: Date, linkedTicketIds: ReadonlySet<string> = new Set()): JsonRecord {
  if (typeof message.body !== "string" || !message.body.trim() || message.body.length > 5000) {
    throw new Error("Le message simulé est vide ou trop long.");
  }
  const allowed: JsonRecord = { body: message.body };
  if (typeof message.isInstruction === "boolean") allowed.isInstruction = message.isInstruction;
  if (message.ttlSeconds !== undefined) allowed.ttlSeconds = message.ttlSeconds;
  if (message.attachment !== undefined) allowed.attachment = message.attachment;
  // A ticket comment mirrored in its discussion may point to that ticket only.
  if (typeof message.ticketId === "string" && linkedTicketIds.has(message.ticketId)) allowed.ticketId = message.ticketId;
  return { ...messageExpiry(allowed, now), id: randomUUID(), author: actor.id, at: newStamp(now), time: shortTime(now) };
}
const isClientSystemNotice = (message: JsonRecord) => message.system === true;

/**
 * Erase the text of expired ephemeral messages. The message keeps its place
 * (id, author, times) so ticket links and read counts stay coherent; its body
 * is replaced by an empty string and marked expired. One journal event per run.
 */
export function purgeExpiredMessages(store: JsonRecord, now = new Date()): { store: JsonRecord; count: number } {
  let count = 0;
  const conversations = records(store.conversations).map((conversation) => {
    let changed = false;
    const messages = records(conversation.messages).map((message) => {
      if (message.expired === true || typeof message.expiresAt !== "string") return message;
      const expiry = Date.parse(message.expiresAt);
      if (!Number.isFinite(expiry) || expiry > now.getTime()) return message;
      count += 1;
      changed = true;
      return { id: message.id, author: message.author, at: message.at, time: message.time, ttlSeconds: message.ttlSeconds, expiresAt: message.expiresAt, expired: true, body: "" };
    });
    return changed ? { ...conversation, messages } : conversation;
  });
  if (count === 0) return { store, count };
  const event = {
    id: randomUUID(),
    type: EPHEMERAL_PURGE_AUDIT_TYPE,
    action: `${count} message(s) éphémère(s) effacé(s) à expiration`,
    actor: "system:ephemeral-purge",
    scope: "Messagerie",
    count,
    at: newStamp(now),
    time: shortTime(now),
  };
  return { store: { ...store, conversations, audit: retainItsmAuditEvents([event, ...records(store.audit)]) }, count };
}

export const INVESTIGATION_CONVERSATION_KIND = "Enquête";
const MAX_INVESTIGATION_MEMBERS = 50;

/**
 * Investigation rooms (cahier des charges, matrice d’habilitation) : created by
 * N1 only, open to N2 analysts named as members, never to N3, N4 or N5.
 */
export const TEMPORARY_CONVERSATION_KIND = "Temporaire";
/** Bilateral channel between exactly two N1–N3 agents, visible to them only. */
export const DIRECT_CONVERSATION_KIND = "Direct";
/**
 * Support services (N4, cahier des charges) : administrative collaborative
 * rooms and general announcements only, never the investigation flows.
 * Announcements are published by the Direction (N1) and read by N1–N4.
 */
export const ANNOUNCEMENT_CONVERSATION_KIND = "Annonce";
export const ADMINISTRATIVE_CONVERSATION_KIND = "Administratif";
const SUPPORT_SERVICE_KINDS = new Set([ANNOUNCEMENT_CONVERSATION_KIND, ADMINISTRATIVE_CONVERSATION_KIND]);
export const MIN_TEMPORARY_HOURS = 1;
export const MAX_TEMPORARY_HOURS = 30 * 24;

const isMember = (actor: Pick<WorkspaceActor, "id">, conversation: JsonRecord) =>
  Array.isArray(conversation.memberIds) && conversation.memberIds.includes(actor.id);

/** A temporary channel is closed once its end date has passed. */
export function isClosedConversation(conversation: JsonRecord, now = new Date()): boolean {
  if (conversation.kind !== TEMPORARY_CONVERSATION_KIND) return false;
  if (typeof conversation.expiresAt !== "string" || conversation.expiresAt.trim() === "") return true;
  const end = Date.parse(conversation.expiresAt);
  return !Number.isFinite(end) || end <= now.getTime();
}

export function canSeeConversation(actor: Pick<WorkspaceActor, "id" | "role">, conversation: JsonRecord, now = new Date()): boolean {
  if (actor.role === "N4") return SUPPORT_SERVICE_KINDS.has(String(conversation.kind));
  // Temporary channels (cahier des charges, niveau 5) : ad-hoc, time-limited,
  // opened by N1 to named members; external auditors lose access at the end date.
  if (conversation.kind === TEMPORARY_CONVERSATION_KIND) {
    if (actor.role === "N1") return true;
    if (!isMember(actor, conversation)) return false;
    return actor.role !== "N5" || !isClosedConversation(conversation, now);
  }
  if (actor.role === "N5") return false;
  // Bilateral channels: only the two agents, not even the Direction (N1).
  if (conversation.kind === DIRECT_CONVERSATION_KIND) return isMember(actor, conversation);
  if (conversation.kind !== INVESTIGATION_CONVERSATION_KIND) return true;
  if (actor.role === "N1") return true;
  return actor.role === "N2" && isMember(actor, conversation);
}

/**
 * Message from a member of a temporary channel. Auditors (N5) cannot save the
 * workspace, so they post through this narrow command only.
 */
export function postTemporaryChannelMessage(
  current: JsonRecord,
  conversationId: string,
  body: unknown,
  actor: WorkspaceActor,
  now = new Date(),
): JsonRecord {
  const conversations = records(current.conversations);
  const index = conversations.findIndex((conversation) => conversation.id === conversationId);
  const conversation = conversations[index];
  if (!conversation || conversation.kind !== TEMPORARY_CONVERSATION_KIND || !canSeeConversation(actor, conversation, now)) {
    throw new ItsmAuthorizationError("Ce canal temporaire n’est pas accessible à ce compte.");
  }
  if (isClosedConversation(conversation, now)) throw new Error("Ce canal temporaire est clos.");
  if (typeof body !== "string" || !body.trim() || body.length > 5000) throw new Error("Le message est vide ou trop long.");
  const message = { id: randomUUID(), author: actor.id, body: body.trim(), at: newStamp(now), time: shortTime(now) };
  const next = structuredClone(current);
  const nextConversations = records(next.conversations);
  nextConversations[index] = { ...conversation, messages: [...records(conversation.messages), message] };
  next.conversations = nextConversations;
  next.audit = retainItsmAuditEvents([{
    id: randomUUID(),
    action: `Message publié dans le canal temporaire ${conversationId}`,
    actor: actor.id,
    scope: "Messagerie · canal temporaire",
    conversationId,
    at: newStamp(now),
    time: shortTime(now),
  }, ...records(next.audit)]);
  return next;
}

/**
 * Applies a client snapshot as a constrained command. The authenticated actor,
 * workflow timestamps, ticket IDs, and KEDB entries are always server-owned.
 */
export function applyWorkspaceUpdate(
  current: JsonRecord,
  submitted: JsonRecord,
  actor: WorkspaceActor,
  now = new Date(),
): JsonRecord {
  requirePermission(actor, "saveWorkspace");
  const next = structuredClone(current);
  const normalized = structuredClone(submitted);
  const oldTickets = records(current.tickets);
  const oldConversations = records(current.conversations);
  if (actor.role === "N4") {
    const submittedTicketIds = new Set(records(normalized.tickets).map((ticket) => String(ticket.id)));
    const hiddenTickets = oldTickets.filter((ticket) =>
      !actor.serviceIds.includes(String(ticket.serviceId ?? "")) && !submittedTicketIds.has(String(ticket.id)));
    normalized.tickets = [...records(normalized.tickets), ...hiddenTickets];
  }
  {
    // Rooms this account cannot see are not sent to it: keep them in place.
    const submittedConversations = records(normalized.conversations);
    if (submittedConversations.some((conversation) => {
      const stored = oldConversations.find((item) => item.id === conversation.id);
      return stored ? !canSeeConversation(actor, stored, now) : false;
    })) {
      throw new ItsmAuthorizationError("Cette conversation n’est pas accessible à ce compte.");
    }
    const merged = [...submittedConversations];
    oldConversations.forEach((conversation, index) => {
      if (!canSeeConversation(actor, conversation, now)) merged.splice(Math.min(index, merged.length), 0, conversation);
    });
    normalized.conversations = merged;
  }
  const currentConversationContent = records(current.conversations).map(({ readCount: _readCount, ...conversation }) => conversation);
  const submittedConversationContent = records(normalized.conversations).map(({ readCount: _readCount, ...conversation }) => conversation);
  if (!jsonEqual(currentConversationContent, submittedConversationContent) && actor.role !== "N4") {
    // N4 only ever receives and submits its administrative rooms and announcements;
    // the rules on those two kinds are enforced conversation by conversation below.
    requirePermission(actor, "manageConversations");
  }
  const currentAuditById = new Map(records(current.audit).map((event) => [String(event.id), event]));
  for (const event of records(normalized.audit)) {
    const existing = currentAuditById.get(String(event.id));
    if (ITSM_ROLE_AUDIT_TYPES.includes(event.type as typeof ITSM_ROLE_AUDIT_TYPES[number]) && !existing) {
      throw new ItsmAuthorizationError("Les événements d’habilitation sont créés uniquement par le serveur.");
    }
    if (!existing && typeof event.type === "string" && event.type.startsWith("itsm.")) {
      throw new ItsmAuthorizationError("Les événements système du journal sont créés uniquement par le serveur.");
    }
    if (existing && ITSM_ROLE_AUDIT_TYPES.includes(existing.type as typeof ITSM_ROLE_AUDIT_TYPES[number])
      && !jsonEqual(existing, event)) {
      throw new ItsmAuthorizationError("Un événement d’habilitation existant ne peut pas être modifié.");
    }
  }
  const currentAuditIds = new Set(records(current.audit).map((event) => String(event.id)));
  if (records(normalized.audit).some((event) => !currentAuditIds.has(String(event.id)))) {
    requirePermission(actor, "appendAudit");
  }
  const proposedTickets = records(normalized.tickets);
  const proposedTicketIds = proposedTickets.map((ticket) => String(ticket.id ?? ""));
  if (proposedTicketIds.some((id) => !id) || new Set(proposedTicketIds).size !== proposedTicketIds.length) {
    throw new Error("Les identifiants de tickets doivent être présents et uniques.");
  }
  const oldById = new Map(oldTickets.map((ticket) => [String(ticket.id), ticket]));
  const serviceIds = new Set(records(current.services).map((service) => String(service.id)));
  const assetIds = new Set(records(current.assets).map((asset) => String(asset.id)));
  const nextTickets: JsonRecord[] = [];

  for (const proposed of proposedTickets) {
    const submittedId = String(proposed.id ?? "");
    const old = oldById.get(submittedId);
    if (!old) {
      const invalid = validateTicketBasics(proposed);
      if (invalid) throw new Error(invalid);
      const sourceMessageId = String(proposed.sourceMessageId ?? "");
      const conversationId = String(proposed.conversationId ?? "");
      if (sourceMessageId || conversationId) {
        const conversation = oldConversations.find((item) => String(item.id) === conversationId);
        const sourceExists = records(conversation?.messages)
          .some((message) => String(message.id) === sourceMessageId);
        if (proposed.kind !== "Incident" || !sourceMessageId || !conversationId
          || conversation?.kind !== "Support" || !sourceExists) {
          throw new Error("La conversion doit référencer un message existant du canal support.");
        }
        if (oldTickets.some((ticket) => String(ticket.sourceMessageId ?? "") === sourceMessageId)
          || nextTickets.some((ticket) => String(ticket.sourceMessageId ?? "") === sourceMessageId)) {
          throw new Error("Ce message a déjà été converti en incident.");
        }
      }
      const createPermission = proposed.kind === "Problème"
        ? "createProblem"
        : proposed.kind === "Changement" ? "createChange" : "createIncident";
      requirePermission(actor, createPermission);
      if (proposed.serviceId && !serviceIds.has(String(proposed.serviceId))) throw new Error("Service associé introuvable.");
      if (proposed.assetId && !assetIds.has(String(proposed.assetId))) throw new Error("Équipement associé introuvable.");
      // A problem opened from recurring incidents keeps their ids; fixed here and never editable afterwards.
      const incidentIds = proposed.incidentIds ?? null;
      if (incidentIds !== null) {
        const incidents = new Set(oldTickets.filter((ticket) => ticket.kind === "Incident").map((ticket) => String(ticket.id)));
        if (proposed.kind !== "Problème" || !Array.isArray(incidentIds) || !incidentIds.length || incidentIds.length > 50
          || new Set(incidentIds).size !== incidentIds.length
          || !incidentIds.every((ticketId) => typeof ticketId === "string" && incidents.has(ticketId))) {
          throw new Error("Un problème ne peut référencer que des incidents existants, sans doublon (50 au plus).");
        }
      }
      const template = proposed.template ?? null;
      if (template !== null && (proposed.kind !== "Demande" || AUTO_APPROVED_REQUESTS.get(String(template)) !== proposed.category)) {
        throw new Error("Modèle de demande standard invalide.");
      }
      const id = nextTicketId(proposed.kind, [...oldTickets, ...nextTickets]);
      const priority = PRIORITY[String(proposed.impact)]![Number(proposed.urgency) - 1];
      const at = newStamp(now);
      const created = {
        id,
        title: proposed.title,
        kind: proposed.kind,
        category: proposed.category,
        impact: proposed.impact,
        urgency: proposed.urgency,
        priority,
        supportLevel: proposed.supportLevel,
        assignee: proposed.assignee,
        requester: actor.id,
        requesterId: actor.id,
        serviceId: proposed.serviceId ?? null,
        assetId: proposed.assetId ?? null,
        description: proposed.description,
        rootCause: null,
        resolution: null,
        conversationId: proposed.conversationId ?? null,
        sourceMessageId: proposed.sourceMessageId ?? null,
        status: template ? "Pris en compte" : "Nouveau",
        openedAt: at,
        acknowledgedAt: template ? at : null,
        resolvedAt: null,
        closedAt: null,
        cab: null,
        kedbId: null,
        ...(incidentIds ? { incidentIds } : {}),
        ...(template ? { template } : {}),
        updates: [],
      };
      nextTickets.push(eventFor(created, `Ticket créé en ${priority} (impact ${proposed.impact}, urgence ${proposed.urgency}).${template ? ` Demande standard « ${template} » prise en compte automatiquement.` : ""}`, actor, now));
      continue;
    }

    const invalid = validateTicketBasics(proposed);
    if (invalid) throw new Error(invalid);
    const id = String(old.id);
    if (proposed.requester !== old.requester || proposed.openedAt !== old.openedAt) {
      // These values are server-owned; ignore client attempts rather than accepting them.
    }
    const oldStatus = String(old.status);
    const requestedStatus = String(proposed.status);
    const resolutionChanged = !jsonEqual(old.rootCause, proposed.rootCause)
      || !jsonEqual(old.resolution, proposed.resolution);
    if (!ALLOWED_TRANSITIONS[oldStatus]?.includes(requestedStatus) && requestedStatus !== oldStatus) {
      throw new Error(`Transition non autorisée : ${oldStatus} vers ${requestedStatus}.`);
    }
    if (oldStatus === "Clos" || oldStatus === "Rejeté") {
      if (!jsonEqual(old, proposed)) throw new Error("Un ticket clos ou rejeté ne peut plus être modifié.");
      nextTickets.push(old);
      continue;
    }

    const oldCab = isRecord(old.cab) ? old.cab : null;
    const proposedCab = isRecord(proposed.cab) ? proposed.cab : null;
    const cabChanged = !jsonEqual(oldCab, proposedCab);
    const hasTicketChanges = TICKET_FIELDS.some((field) => !jsonEqual(old[field], proposed[field]))
      || oldStatus !== requestedStatus
      || !jsonEqual(old.updates ?? [], proposed.updates ?? []);
    if (hasTicketChanges) {
      const requesterClosure = requestedStatus === "Clos"
        && oldStatus === "Résolu"
        && old.requesterId === actor.id
        && !cabChanged
        && TICKET_FIELDS.every((field) => jsonEqual(old[field], proposed[field]));
      if (cabChanged) {
        requirePermission(actor, "approveCab", old.serviceId as string | null | undefined);
        const otherChanges = TICKET_FIELDS.some((field) =>
          field !== "cab" && !jsonEqual(old[field], proposed[field]))
          || (requestedStatus !== oldStatus && requestedStatus !== "Rejeté");
        if (otherChanges) throw new ItsmAuthorizationError("Une décision CAB ne peut pas être combinée à une autre modification du ticket.");
      } else if (requesterClosure) {
        requirePermission(actor, "confirmClosure");
      } else {
        requirePermission(actor, "manageTicket", old.serviceId as string | null | undefined);
      }
      if (requestedStatus === "Résolu") requirePermission(actor, "resolveTicket");
      if (actor.role === "N4"
        && (String(proposed.serviceId ?? "") !== String(old.serviceId ?? "")
          || String(proposed.assetId ?? "") !== String(old.assetId ?? ""))) {
        throw new ItsmAuthorizationError("Le périmètre de service et l’équipement ne peuvent pas être modifiés par N4.");
      }
    }
    if (cabChanged) {
      if (old.kind !== "Changement" || !proposedCab
        || !["Approuvé", "Rejeté"].includes(String(proposedCab.decision))) {
        throw new Error("Décision CAB invalide pour ce ticket.");
      }
      if (oldCab) throw new Error("Une décision CAB enregistrée ne peut pas être remplacée.");
      if (old.requesterId && old.requesterId === actor.id) {
        throw new Error("Le demandeur ne peut pas approuver ou rejeter son propre changement.");
      }
      if (proposedCab.decision === "Rejeté" && (typeof proposedCab.reason !== "string" || !proposedCab.reason.trim())) {
        throw new Error("Un motif est obligatoire pour un rejet CAB.");
      }
    }
    if (requestedStatus === "Rejeté"
      && (old.kind !== "Changement" || proposedCab?.decision !== "Rejeté" || !cabChanged)) {
      throw new Error("Seul un rejet CAB motivé peut rejeter un changement.");
    }
    if (requestedStatus === "Clos"
      && (oldStatus !== "Résolu" || typeof old.rootCause !== "string" || old.rootCause.trim().length < 10
        || typeof old.resolution !== "string" || old.resolution.trim().length < 10)) {
      throw new Error("Une résolution documentée est nécessaire avant la confirmation.");
    }
    if (requestedStatus === "Clos" && old.requesterId && old.requesterId !== actor.id) {
      throw new Error("Seul le demandeur authentifié peut confirmer la clôture de ce ticket.");
    }
    if (requestedStatus === "Résolu" && (oldStatus !== "Résolu" || resolutionChanged)
      && (typeof proposed.rootCause !== "string" || proposed.rootCause.trim().length < 10
        || typeof proposed.resolution !== "string" || proposed.resolution.trim().length < 10)) {
      throw new Error("Documentez la cause racine et la solution (10 caractères minimum).");
    }
    if (requestedStatus === "Résolu" && old.kind === "Changement" && proposedCab?.decision !== "Approuvé") {
      throw new Error("Une approbation CAB est nécessaire avant la résolution.");
    }
    if (old.kind === "Changement" && ["En cours", "Résolu"].includes(requestedStatus)
      && proposedCab?.decision !== "Approuvé") {
      throw new Error("Une approbation CAB est nécessaire avant le démarrage.");
    }
    if ((oldStatus !== "Nouveau" || oldCab) && old.kind !== proposed.kind) throw new Error("Le type ne peut pas changer après la prise en charge ou une décision CAB.");
    if (Number(proposed.supportLevel) !== Number(old.supportLevel)
      && Number(proposed.supportLevel) !== Number(old.supportLevel) + 1) {
      throw new Error("Une escalade ne peut progresser que d’un seul niveau.");
    }
    if (proposed.serviceId && !serviceIds.has(String(proposed.serviceId))) throw new Error("Service associé introuvable.");
    if (proposed.assetId && !assetIds.has(String(proposed.assetId))) throw new Error("Équipement associé introuvable.");
    // Satisfaction (1–5) is given only with the closure confirmation; the checks above decide who may confirm.
    const satisfaction = proposed.satisfaction ?? null;
    if (!jsonEqual(old.satisfaction ?? null, satisfaction)) {
      if (requestedStatus !== "Clos" || oldStatus !== "Résolu") {
        throw new ItsmAuthorizationError("La satisfaction se note uniquement en confirmant la clôture.");
      }
      if (!Number.isInteger(satisfaction) || (satisfaction as number) < 1 || (satisfaction as number) > 5) {
        throw new Error("La satisfaction doit être une note entière de 1 à 5.");
      }
    }

    const updated: JsonRecord = { ...old };
    // Key present only once rated: closed tickets are compared byte for byte, so no `null` is added to older ones.
    if (satisfaction !== null) updated.satisfaction = satisfaction;
    for (const field of TICKET_FIELDS) {
      if (field === "cab") continue;
      updated[field] = proposed[field];
    }
    updated.priority = PRIORITY[String(proposed.impact)]![Number(proposed.urgency) - 1];
    updated.status = requestedStatus;
    updated.requester = old.requester;
    updated.openedAt = old.openedAt;
    updated.acknowledgedAt = old.acknowledgedAt ?? (requestedStatus !== "Nouveau" ? newStamp(now) : null);
    updated.resolvedAt = requestedStatus === "Résolu"
      ? (old.resolvedAt ?? newStamp(now))
      : requestedStatus === "En cours" && oldStatus === "Résolu" ? null : old.resolvedAt ?? null;
    updated.closedAt = ["Clos", "Rejeté"].includes(requestedStatus)
      ? (old.closedAt ?? newStamp(now)) : old.closedAt ?? null;
    updated.cab = cabChanged && proposedCab
      ? { decision: proposedCab.decision, reason: String(proposedCab.reason ?? "").slice(0, 3000), by: actor.id, at: newStamp(now) }
      : old.cab ?? null;

    const mutableChanged = TICKET_FIELDS.some((field) => field !== "cab" && !jsonEqual(old[field], updated[field]))
      || oldStatus !== requestedStatus || cabChanged
      || !jsonEqual(old.updates ?? [], proposed.updates ?? []);
    if (mutableChanged) {
      const suppliedUpdates = records(proposed.updates);
      const oldUpdates = records(old.updates);
      const proposedLast = suppliedUpdates.at(-1);
      const oldLast = oldUpdates.at(-1);
      const body = proposedLast && !jsonEqual(proposedLast, oldLast) && typeof proposedLast.body === "string"
        ? proposedLast.body.slice(0, 5000)
        : cabChanged
          ? `Décision CAB enregistrée : ${proposedCab?.decision}.${proposedCab?.reason ? ` Motif : ${proposedCab.reason}` : ""}`
          : `Ticket mis à jour : ${requestedStatus}.`;
      nextTickets.push(eventFor(updated, body, actor, now));
    } else {
      nextTickets.push(old);
    }
  }
  const proposedIds = new Set(proposedTicketIds);
  if (oldTickets.some((ticket) => !proposedIds.has(String(ticket.id)))) {
    throw new Error("La suppression de tickets est désactivée dans le pilote.");
  }
  next.tickets = nextTickets;

  const proposedConversations = records(normalized.conversations);
  const ticketsLinkedTo = (conversationId: string) => new Set(nextTickets
    .filter((ticket) => ticket.conversationId === conversationId).map((ticket) => String(ticket.id)));
  const oldConversationIds = new Set(oldConversations.map((conversation) => String(conversation.id)));
  const proposedConversationIds = new Set(proposedConversations.map((conversation) => String(conversation.id)));
  if (proposedConversations.some((conversation) => !String(conversation.id ?? ""))
    || new Set(proposedConversations.map((conversation) => String(conversation.id))).size !== proposedConversations.length) {
    throw new Error("Les identifiants de conversations doivent être présents et uniques.");
  }
  if (oldConversations.some((conversation) => !proposedConversationIds.has(String(conversation.id)))) {
    throw new Error("La suppression des conversations est désactivée dans le pilote.");
  }
  const conversations: JsonRecord[] = [];
  for (const proposed of proposedConversations) {
    const id = String(proposed.id ?? "");
    const old = oldConversations.find((conversation) => conversation.id === id);
    if (!old) {
      if (typeof proposed.title !== "string" || !proposed.title.trim() || !Array.isArray(proposed.participants)) {
        throw new Error("Conversation invalide.");
      }
      const temporary = proposed.kind === TEMPORARY_CONVERSATION_KIND;
      const investigation = proposed.kind === INVESTIGATION_CONVERSATION_KIND || temporary;
      if (investigation && actor.role !== "N1") {
        throw new ItsmAuthorizationError(temporary
          ? "Seul un compte N1 peut ouvrir un canal temporaire."
          : "Seul un compte N1 peut ouvrir un salon d’enquête.");
      }
      if (proposed.kind === ANNOUNCEMENT_CONVERSATION_KIND && actor.role !== "N1") {
        throw new ItsmAuthorizationError("Seule la Direction (N1) ouvre un canal d’annonces.");
      }
      if (actor.role === "N4" && proposed.kind !== ADMINISTRATIVE_CONVERSATION_KIND) {
        throw new ItsmAuthorizationError("Un compte N4 ne peut ouvrir qu’un salon administratif.");
      }
      const direct = proposed.kind === DIRECT_CONVERSATION_KIND;
      let directMembers: string[] = [];
      if (direct) {
        if (!["N1", "N2", "N3"].includes(actor.role)) {
          throw new ItsmAuthorizationError("Seuls les comptes N1 à N3 peuvent ouvrir un canal bilatéral.");
        }
        const others = [...new Set((Array.isArray(proposed.memberIds) ? proposed.memberIds : [])
          .filter((member): member is string => typeof member === "string" && /^user_[A-Za-z0-9]{1,64}$/.test(member) && member !== actor.id))];
        if (others.length !== 1) throw new Error("Un canal bilatéral réunit exactement deux agents.");
        directMembers = [actor.id, others[0]!];
        const pair = [...directMembers].sort().join(",");
        if (oldConversations.some((conversation) => conversation.kind === DIRECT_CONVERSATION_KIND
          && Array.isArray(conversation.memberIds) && [...conversation.memberIds].sort().join(",") === pair)) {
          throw new Error("Un canal bilatéral existe déjà avec cet agent.");
        }
      }
      const hours = Math.round(Math.min(MAX_TEMPORARY_HOURS, Math.max(MIN_TEMPORARY_HOURS, Number(proposed.durationHours) || 24)));
      conversations.push({
        id,
        title: proposed.title,
        kind: typeof proposed.kind === "string" ? proposed.kind : "Équipe",
        classification: investigation ? "Restreint" : direct ? "Confidentiel" : typeof proposed.classification === "string" ? proposed.classification : "Interne",
        ...(investigation ? {
          memberIds: [...new Set([actor.id, ...(Array.isArray(proposed.memberIds) ? proposed.memberIds : [])
            .filter((member): member is string => typeof member === "string" && /^user_[A-Za-z0-9]{1,64}$/.test(member))])]
            .slice(0, MAX_INVESTIGATION_MEMBERS),
        } : {}),
        ...(direct ? { memberIds: directMembers } : {}),
        ...(temporary ? { expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString() } : {}),
        participants: direct ? directMembers : proposed.participants.filter((participant): participant is string => typeof participant === "string").slice(0, 20),
        readCount: Math.max(0, Math.min(records(proposed.messages).length, Number(proposed.readCount) || 0)),
        messages: records(proposed.messages).filter((message) => !isClientSystemNotice(message))
          .map((message) => clientMessage(message, actor, now, ticketsLinkedTo(id))),
      });
      continue;
    }
    const oldMessages = records(old.messages);
    const incomingMessages = records(proposed.messages);
    const { readCount: _oldReadCount, messages: _oldMessageContent, ...oldContent } = old;
    const { readCount: _submittedReadCount, messages: _submittedMessageContent, ...submittedContent } = proposed;
    if (!jsonEqual(oldContent, submittedContent)) {
      throw new Error("Les informations d’une conversation existante ne peuvent pas être réécrites.");
    }
    if (incomingMessages.length < oldMessages.length
      || oldMessages.some((message, index) => message.id !== incomingMessages[index]?.id || message.body !== incomingMessages[index]?.body)) {
      throw new Error("L’historique de messagerie ne peut pas être réécrit.");
    }
    const appended = incomingMessages.slice(oldMessages.length).filter((message) => !isClientSystemNotice(message));
    if (appended.length > 0 && old.kind === ANNOUNCEMENT_CONVERSATION_KIND && actor.role !== "N1") {
      throw new ItsmAuthorizationError("Seule la Direction (N1) publie dans les annonces.");
    }
    if (appended.length > 0 && isClosedConversation(old, now)) {
      throw new Error("Ce canal temporaire est clos : il n’accepte plus de messages.");
    }
    const messages = [
      ...oldMessages,
      ...appended.map((message) => clientMessage(message, actor, now, ticketsLinkedTo(id))),
    ];
    conversations.push({ ...old, messages });
    const readStates = isRecord(next.readStates) ? next.readStates : {};
    const userReadStates = isRecord(readStates[actor.id]) ? readStates[actor.id] as JsonRecord : {};
    readStates[actor.id] = {
      ...userReadStates,
      [id]: Math.max(0, Math.min(messages.length, Number(proposed.readCount) || 0)),
    };
    next.readStates = readStates;
  }
  // A new incident converted from a support message is announced in that
  // channel by the server (the browser's own notice is dropped above).
  for (const ticket of nextTickets) {
    if (oldTickets.some((item) => item.id === ticket.id)) continue;
    if (typeof ticket.conversationId !== "string" || typeof ticket.sourceMessageId !== "string" || !ticket.sourceMessageId) continue;
    const index = conversations.findIndex((conversation) => conversation.id === ticket.conversationId);
    if (index < 0) continue;
    const thread = conversations[index]!;
    conversations[index] = { ...thread, messages: [...records(thread.messages), {
      id: randomUUID(),
      author: `Suivi ${String(ticket.id)}`,
      body: `Incident ${String(ticket.id)} ouvert en ${String(ticket.priority ?? "")} à partir d’un message du canal.`,
      time: shortTime(now),
      at: newStamp(now),
      system: true,
      ticketId: ticket.id,
    }] };
  }
  // A ticket's status changes feed its linked discussion, so the requester
  // follows the progress without leaving the messaging (cahier des charges).
  for (const ticket of nextTickets) {
    const prior = oldTickets.find((item) => item.id === ticket.id);
    if (!prior || prior.status === ticket.status || typeof ticket.conversationId !== "string") continue;
    const index = conversations.findIndex((conversation) => conversation.id === ticket.conversationId);
    if (index < 0) continue;
    const thread = conversations[index]!;
    conversations[index] = { ...thread, messages: [...records(thread.messages), {
      id: randomUUID(),
      author: `Suivi ${String(ticket.id)}`,
      body: `Ticket ${String(ticket.id)} : ${String(prior.status)} → ${String(ticket.status)}.`,
      time: shortTime(now),
      at: newStamp(now),
      system: true,
      ticketId: ticket.id,
    }] };
  }
  next.conversations = conversations;

  const oldAudit = records(current.audit);
  const knownAuditIds = new Set(oldAudit.map((event) => String(event.id)));
  const additions = records(normalized.audit)
    .filter((event) => !knownAuditIds.has(String(event.id)))
    .map((event) => ({
      ...stripAuditChainFields(event), id: randomUUID(), actor: actor.id, at: newStamp(now), time: shortTime(now),
    }));
  const knownConversions = new Set(oldAudit
    .filter((event) => event.type === ITSM_TICKET_CONVERSION_AUDIT_TYPE)
    .map((event) => String(event.sourceMessageId ?? "")));
  const conversionEvents = nextTickets
    .filter((ticket) => !oldById.has(String(ticket.id))
      && typeof ticket.sourceMessageId === "string"
      && Boolean(ticket.sourceMessageId)
      && !knownConversions.has(String(ticket.sourceMessageId)))
    .map((ticket) => {
      const at = newStamp(now);
      return {
        id: randomUUID(),
        type: ITSM_TICKET_CONVERSION_AUDIT_TYPE,
        action: `Message ${ticket.sourceMessageId} du canal support converti en incident ${ticket.id}`,
        actor: actor.id,
        scope: "Messagerie · support",
        ticketId: ticket.id,
        conversationId: ticket.conversationId,
        sourceMessageId: ticket.sourceMessageId,
        at,
        time: shortTime(now),
      };
    });
  next.audit = retainItsmAuditEvents([...conversionEvents, ...additions, ...oldAudit]);

  // KEDB is generated exclusively by the server when requester confirmation closes a ticket.
  const kedb = records(current.kedb);
  for (const ticket of nextTickets) {
    const prior = oldById.get(String(ticket.id));
    if (prior?.status === "Résolu" && ticket.status === "Clos" && !kedb.some((article) => article.ticketId === ticket.id)) {
      const number = kedb.reduce((max, article) => Math.max(max, Number(String(article.id).replace(/\D/g, "")) || 100), 100) + 1;
      const articleId = `KEDB-${String(number).padStart(4, "0")}`;
      ticket.kedbId = articleId;
      kedb.unshift({
        id: articleId, title: ticket.title, symptom: ticket.description,
        rootCause: ticket.rootCause, resolution: ticket.resolution,
        ticketId: ticket.id, serviceId: ticket.serviceId ?? null, category: ticket.category,
        createdAt: ticket.closedAt, author: actor.id,
      });
    }
  }
  next.kedb = kedb;

  for (const field of ["services", "assets"] as const) next[field] = current[field] ?? [];
  next.profile = current.profile;
  next.theme = current.theme;
  next.drafts = current.drafts;
  next.seeded = current.seeded;
  next.schema = current.schema ?? 2;
  return next;
}

export type VersionedWorkspaceSave =
  | { conflict: true; store: JsonRecord; version: number }
  | { conflict: false; store: JsonRecord; version: number };

export const ITSM_WORKSPACE_VERSION_CONFLICT_MESSAGE =
  "La modification a été refusée, car l’espace partagé a changé. L’état distant actuel est joint pour permettre une reprise contrôlée.";

export type ItsmWorkspaceVersionConflictResponse = {
  error: typeof ITSM_WORKSPACE_VERSION_CONFLICT_MESSAGE;
  current: { store: JsonRecord; version: number };
};

export function workspaceVersionConflictResponse(
  store: JsonRecord,
  version: number,
  actor: WorkspaceActor,
): ItsmWorkspaceVersionConflictResponse {
  return {
    error: ITSM_WORKSPACE_VERSION_CONFLICT_MESSAGE,
    current: { store: userStoreView(store, actor), version },
  };
}

/**
 * Checks a client base version and applies its constrained update as one
 * service operation. Callers must run this while holding the workspace row
 * lock so competing saves are evaluated against the latest committed version.
 */
export function saveWorkspaceAtVersion(
  current: JsonRecord,
  currentVersion: number,
  submitted: JsonRecord,
  expectedVersion: number,
  actor: WorkspaceActor,
  now = new Date(),
): VersionedWorkspaceSave {
  if (currentVersion !== expectedVersion) {
    return { conflict: true, store: structuredClone(current), version: currentVersion };
  }
  return {
    conflict: false,
    store: applyWorkspaceUpdate(current, submitted, actor, now),
    version: currentVersion + 1,
  };
}

export function mergeLocalExamples(
  current: JsonRecord,
  imported: JsonRecord,
  actor: WorkspaceActor,
  now = new Date(),
): JsonRecord {
  return importMerge(current, imported, actor, now);
}

export function userStoreView(store: JsonRecord, actor: WorkspaceActor, now = new Date()): JsonRecord {
  const { readStates, ...visibleStore } = store;
  const actorReads = isRecord(readStates) && isRecord(readStates[actor.id]) ? readStates[actor.id] as JsonRecord : {};
  const scopedTickets = records(store.tickets).filter((ticket) =>
    actor.role !== "N4" || actor.serviceIds.includes(String(ticket.serviceId ?? "")));
  const scopedTicketIds = new Set(scopedTickets.map((ticket) => String(ticket.id)));
  const scopedAssets = records(store.assets).filter((asset) =>
    scopedTickets.some((ticket) => ticket.assetId === asset.id));
  const scopedServices = records(store.services).filter((service) =>
    actor.role !== "N4" || actor.serviceIds.includes(String(service.id)));
  const hiddenCollections = actor.role === "N5";
  return {
    ...visibleStore,
    tickets: hiddenCollections ? [] : scopedTickets,
    conversations: records(store.conversations).filter((conversation) => canSeeConversation(actor, conversation, now)).map((conversation) => ({
      ...conversation,
      readCount: Number(actorReads[String(conversation.id)] ?? conversation.readCount) || 0,
    })),
    services: actor.role === "N5" ? [] : scopedServices,
    assets: actor.role === "N4" ? scopedAssets : hiddenCollections ? [] : records(store.assets),
    // The RFC 3161 token (a few kB) is served by GET /itsm/audit/timestamps/:id/token, not with every view.
    audit: actor.role === "N4" ? [] : records(store.audit).filter((event) => !isPrunedAuditEvent(event))
      .map(({ token: _token, ...event }) => event),
    kedb: actor.role === "N4"
      ? records(store.kedb).filter((article) => actor.serviceIds.includes(String(article.serviceId ?? "")))
      : records(store.kedb),
    notifications: actor.role === "N4"
      ? records(store.notifications).filter((item) => scopedTicketIds.has(String(item.ticketId)))
      : hiddenCollections ? [] : records(store.notifications),
    seeded: [...new Set([
      ...(Array.isArray(store.seeded) ? store.seeded.filter((entry): entry is string => typeof entry === "string") : []),
      "support-channel",
      "itil-tickets",
    ])],
    profile: {
      name: actor.id,
      role: actor.role === "N1" ? "Direction"
        : actor.role === "N2" ? "Analyste"
          : actor.role === "N3" ? "SSI / support"
            : actor.role === "N4" ? "Services d’appui" : "Auditeur temporaire",
      clearance: `${actor.role} · ${actor.role === "N1" ? "Pilotage" : actor.role === "N2" ? "Interne" : actor.role === "N3" ? "Technique" : actor.role === "N4" ? "Périmètre" : "Lecture"}`,
    },
  };
}
