import {
  DEFAULT_ITSM_SLA_CALENDAR,
  addItsmBusinessMinutes,
  itsmBusinessMinutesBetween,
  itsmPausedBusinessMinutesBetween,
  type ItsmSlaCalendar,
  type ItsmSlaPause,
} from "./itsm-sla-calendar.ts";

/**
 * Server-side record of SLA breaches. The browser already shows its own
 * countdowns and alerts; this adds a journal trace (time, priority, level,
 * assignee) and an operational log alert, once per ticket and deadline.
 *
 * The browser and monitor share the Libreville pilot calendar and exclude
 * server-recorded periods spent in "En attente".
 */

type JsonRecord = Record<string, unknown>;

export const ITSM_SLA_BREACH_AUDIT_TYPE = "itsm.sla.breached";
export const SLA_MONITOR_ACTOR = "system:sla-monitor";

export const SLA_POLICY_MINUTES: Readonly<Record<string, { acknowledge: number; resolve: number }>> = {
  P1: { acknowledge: 15, resolve: 120 },
  P2: { acknowledge: 30, resolve: 240 },
  P3: { acknowledge: 120, resolve: 480 },
  P4: { acknowledge: 240, resolve: 2880 },
};

const CLOSED_STATUSES = new Set(["Clos", "Rejeté"]);

export type SlaBreach = {
  ticketId: string;
  deadline: "acknowledge" | "resolve";
  priority: string;
  dueAt: string;
  supportLevel: unknown;
  assignee: unknown;
  serviceId: string | null;
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const breachKey = (ticketId: string, deadline: string) => `${ticketId}:${deadline}`;

/** Breaches due at `now` that the journal does not record yet. */
function ticketSlaPauses(ticket: JsonRecord): ItsmSlaPause[] {
  return (Array.isArray(ticket.slaPauses) ? ticket.slaPauses : []).flatMap((value): ItsmSlaPause[] => {
    if (!isRecord(value) || typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))) return [];
    return [{
      startedAt: value.startedAt,
      ...(typeof value.endedAt === "string" && Number.isFinite(Date.parse(value.endedAt))
        ? { endedAt: value.endedAt }
        : {}),
    }];
  });
}

export function findNewSlaBreaches(
  tickets: unknown,
  audit: unknown,
  now: Date,
  calendar: ItsmSlaCalendar = DEFAULT_ITSM_SLA_CALENDAR,
): SlaBreach[] {
  const recorded = new Set((Array.isArray(audit) ? audit : []).filter(isRecord)
    .filter((event) => event.type === ITSM_SLA_BREACH_AUDIT_TYPE)
    .map((event) => breachKey(String(event.ticketId), String(event.deadline))));
  const breaches: SlaBreach[] = [];
  for (const ticket of (Array.isArray(tickets) ? tickets : []).filter(isRecord)) {
    if (CLOSED_STATUSES.has(String(ticket.status))) continue;
    const policy = SLA_POLICY_MINUTES[String(ticket.priority)];
    const opened = typeof ticket.openedAt === "string" ? Date.parse(ticket.openedAt) : Number.NaN;
    if (!policy || !Number.isFinite(opened) || typeof ticket.id !== "string") continue;
    const pauses = ticketSlaPauses(ticket);
    const checks = [
      { deadline: "acknowledge" as const, minutes: policy.acknowledge, completedAt: ticket.acknowledgedAt },
      { deadline: "resolve" as const, minutes: policy.resolve, completedAt: ticket.resolvedAt },
    ];
    for (const { deadline, minutes, completedAt } of checks) {
      const completed = typeof completedAt === "string" && completedAt ? Date.parse(completedAt) : Number.NaN;
      const evaluatedAt = Number.isFinite(completed) ? completed : now.getTime();
      const pausedMinutes = itsmPausedBusinessMinutesBetween(opened, evaluatedAt, pauses, calendar);
      const elapsedMinutes = Math.max(0, itsmBusinessMinutesBetween(opened, evaluatedAt, calendar) - pausedMinutes);
      const dueAt = addItsmBusinessMinutes(opened, minutes + pausedMinutes, calendar);
      // Completed in time, or not due yet: nothing to record. A late completion is still a breach.
      if (elapsedMinutes <= minutes) continue;
      if (recorded.has(breachKey(ticket.id, deadline))) continue;
      breaches.push({
        ticketId: ticket.id,
        deadline,
        priority: String(ticket.priority),
        dueAt,
        supportLevel: ticket.supportLevel,
        assignee: ticket.assignee,
        serviceId: typeof ticket.serviceId === "string" ? ticket.serviceId : null,
      });
    }
  }
  return breaches;
}

export function slaBreachAuditEvent(breach: SlaBreach, id: string, at: string, time: string): JsonRecord {
  const what = breach.deadline === "acknowledge" ? "Délai de prise en charge" : "Délai de résolution";
  return {
    id,
    type: ITSM_SLA_BREACH_AUDIT_TYPE,
    action: `${what} dépassé pour ${breach.ticketId} (${breach.priority})`,
    actor: SLA_MONITOR_ACTOR,
    scope: `Ticket ${breach.ticketId}`,
    ticketId: breach.ticketId,
    deadline: breach.deadline,
    priority: breach.priority,
    dueAt: breach.dueAt,
    supportLevel: breach.supportLevel,
    assignee: breach.assignee,
    serviceId: breach.serviceId,
    at,
    time,
  };
}

export const ITSM_SLA_ESCALATION_AUDIT_TYPE = "itsm.sla.escalated";
export const SENIOR_L2_ASSIGNEE = "Ingénieur senior L2";
const DAY_MS = 86_400_000;

export type SlaEscalationRule = "approach" | "p1-crisis" | "p2-senior" | "p3-coordinator" | "p4-reminder";

export type SlaEscalation = {
  ticketId: string;
  rule: SlaEscalationRule;
  priority: string;
  /** Who the cahier des charges says is alerted. */
  recipients: string;
  title: string;
  body: string;
  /** P2 rule: automatic reassignment to a senior L2 engineer. */
  reassign?: { assignee: string; supportLevel: number };
  /** P4 rule: a message added to the ticket history for the requester. */
  ticketUpdate?: string;
  /** Distinguishes repeated P4 reminders (one per waiting period). */
  key: string;
};

const lastUpdateAt = (ticket: JsonRecord): number => {
  const updates = Array.isArray(ticket.updates) ? ticket.updates.filter(isRecord) : [];
  const stamps = updates.map((update) => typeof update.at === "string" ? Date.parse(update.at) : Number.NaN)
    .filter(Number.isFinite);
  return stamps.length ? Math.max(...stamps) : Date.parse(String(ticket.openedAt));
};

/**
 * Escalation circuit of the SLA table (cahier des charges, gestion des incidents):
 * - any priority, 80 % of the acknowledgement time without acknowledgement: Responsable SI;
 * - P1 open: DSI, RSSI and Direction générale, crisis cell;
 * - P2, 45 min without acknowledgement: reassigned to a senior L2 engineer;
 * - P3, 4 h without acknowledgement: L1 queue coordinator;
 * - P4 waiting 3 days for the requester: automatic reminder (once per waiting period).
 * Business-time thresholds use the pilot calendar; the separate P4 requester
 * reminder remains a three-calendar-day follow-up.
 */
export function findSlaEscalations(
  tickets: unknown,
  audit: unknown,
  now: Date,
  calendar: ItsmSlaCalendar = DEFAULT_ITSM_SLA_CALENDAR,
): SlaEscalation[] {
  const done = new Set((Array.isArray(audit) ? audit : []).filter(isRecord)
    .filter((event) => event.type === ITSM_SLA_ESCALATION_AUDIT_TYPE)
    .map((event) => String(event.escalationKey)));
  const out: SlaEscalation[] = [];
  const nowMs = now.getTime();
  for (const ticket of (Array.isArray(tickets) ? tickets : []).filter(isRecord)) {
    if (CLOSED_STATUSES.has(String(ticket.status)) || ticket.status === "Résolu" || typeof ticket.id !== "string") continue;
    const priority = String(ticket.priority);
    const policy = SLA_POLICY_MINUTES[priority];
    const opened = Date.parse(String(ticket.openedAt));
    if (!policy || !Number.isFinite(opened)) continue;
    const acknowledged = typeof ticket.acknowledgedAt === "string" && Boolean(ticket.acknowledgedAt);
    const pauses = ticketSlaPauses(ticket);
    const elapsed = Math.max(0,
      itsmBusinessMinutesBetween(opened, nowMs, calendar)
      - itsmPausedBusinessMinutesBetween(opened, nowMs, pauses, calendar),
    ) * 60_000;
    const id = ticket.id;
    const push = (escalation: Omit<SlaEscalation, "ticketId" | "priority" | "key"> & { key?: string }) => {
      const key = escalation.key ?? `${id}:${escalation.rule}`;
      if (!done.has(key)) out.push({ ticketId: id, priority, ...escalation, key });
    };
    if (priority === "P1") {
      push({
        rule: "p1-crisis",
        recipients: "DSI, RSSI et Direction générale",
        title: `Incident critique ${id} · cellule de crise`,
        body: `P1 · ${String(ticket.title ?? "")}. DSI, RSSI et Direction générale alertés ; mobilisation de la cellule de crise.`,
      });
    }
    if (!acknowledged && elapsed >= policy.acknowledge * 60_000 * 0.8) {
      push({
        rule: "approach",
        recipients: "Responsable du Service Informatique",
        title: `Escalade · prise en charge bientôt due · ${id}`,
        body: `${priority} · 80 % du délai de prise en charge (${policy.acknowledge} min) écoulé sans prise en charge. Responsable du SI alerté.`,
      });
    }
    if (priority === "P2" && !acknowledged && elapsed >= 45 * 60_000) {
      push({
        rule: "p2-senior",
        recipients: "Superviseur support L2",
        title: `Réaffectation automatique · ${id}`,
        body: `P2 sans prise en charge après 45 min : ticket réaffecté à un ingénieur senior (L2).`,
        reassign: { assignee: SENIOR_L2_ASSIGNEE, supportLevel: Math.max(2, Number(ticket.supportLevel) || 1) },
      });
    }
    if (priority === "P3" && !acknowledged && elapsed >= 4 * 60 * 60_000) {
      push({
        rule: "p3-coordinator",
        recipients: "Coordinateur de la file L1",
        title: `Escalade L1 · ${id}`,
        body: `P3 sans intervention après 4 h : coordinateur de la file L1 alerté. Réévaluer la priorité si l’impact s’élargit.`,
      });
    }
    if (priority === "P4" && ticket.status === "En attente") {
      const since = lastUpdateAt(ticket);
      if (Number.isFinite(since) && nowMs - since >= 3 * DAY_MS) {
        push({
          rule: "p4-reminder",
          key: `${id}:p4-reminder:${new Date(since).toISOString()}`,
          recipients: String(ticket.requester ?? "Demandeur"),
          title: `Relance automatique · ${id}`,
          body: `P4 en attente depuis 3 jours sans réponse du demandeur : relance envoyée.`,
          ticketUpdate: "Relance automatique : merci d’apporter les précisions demandées pour poursuivre le traitement.",
        });
      }
    }
  }
  return out;
}

type MonitorLogger = { warn: (fields: JsonRecord, message: string) => void; error: (fields: JsonRecord, message: string) => void };

/** Checks open tickets every minute and records each new breach once. */
export function createSlaBreachMonitor(options: {
  recordNow: () => Promise<{ breaches: SlaBreach[]; escalations?: SlaEscalation[] }>;
  logger: MonitorLogger;
  intervalMs?: number;
}) {
  let running = false;
  let timer: NodeJS.Timeout | undefined;
  const checkNow = async (): Promise<SlaBreach[]> => {
    if (running) return [];
    running = true;
    try {
      const { breaches, escalations = [] } = await options.recordNow();
      for (const breach of breaches) {
        options.logger.warn({ alert: "itsm_sla_breached", ...breach }, "ITSM_SLA_BREACHED");
      }
      for (const escalation of escalations) {
        options.logger.warn({
          alert: "itsm_sla_escalated", ticketId: escalation.ticketId, rule: escalation.rule,
          priority: escalation.priority, recipients: escalation.recipients,
        }, "ITSM_SLA_ESCALATED");
      }
      return breaches;
    } catch (err) {
      options.logger.error({ err, component: "itsm_sla_monitor" }, "Could not check SLA deadlines");
      return [];
    } finally {
      running = false;
    }
  };
  return {
    checkNow,
    start() {
      timer ??= setInterval(() => { void checkNow(); }, options.intervalMs ?? 60_000);
      timer.unref?.();
      void checkNow();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
