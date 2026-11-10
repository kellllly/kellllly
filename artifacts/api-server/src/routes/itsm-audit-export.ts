import { createHash } from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import {
  ItsmAuthorizationError,
  requirePermission,
} from "../lib/itsm-rbac.ts";
import type { WorkspaceActor } from "../lib/itsm-workspace.ts";
import { isPrunedAuditEvent, verifyAuditChain } from "../lib/itsm-audit-chain.ts";
import { isSeal, merkleInclusionProof, merkleRoot } from "../lib/itsm-audit-merkle.ts";
import { siemPage } from "../lib/itsm-audit-siem.ts";
import { compareWithArchive, type ArchivedSeal } from "../lib/itsm-audit-worm.ts";
import {
  buildTimestampRequest,
  checkpointStatement,
  ITSM_AUDIT_TIMESTAMP_TYPE,
  requestNonce,
  requestTimestamp,
  verifyTimestamp,
  type TimestampVerification,
} from "../lib/itsm-audit-timestamp.ts";
import type { Certificate } from "pkijs";

type AuditExportDependencies = {
  resolveActor: (req: Request, res: Response) => Promise<WorkspaceActor | null>;
  loadAuditEvents: () => Promise<unknown[]>;
  /** Display names for the Clerk IDs found in the journal; IDs it omits keep an empty name. */
  resolveNames?: (ids: string[]) => Promise<ReadonlyMap<string, string>>;
};

const CLERK_USER_ID = /^user_[A-Za-z0-9]{1,64}$/u;

async function namesFor(
  events: readonly Record<string, unknown>[],
  resolveNames: AuditExportDependencies["resolveNames"],
  onError: (error: unknown) => void,
): Promise<ReadonlyMap<string, string>> {
  if (!resolveNames) return new Map();
  const ids = [...new Set(events.flatMap((event) => [event.actor, event.targetUserId])
    .filter((id): id is string => typeof id === "string" && CLERK_USER_ID.test(id)))];
  if (ids.length === 0) return new Map();
  try {
    return await resolveNames(ids);
  } catch (error) {
    // The export stays available with IDs only if the directory is down.
    onError(error);
    return new Map();
  }
}

function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (typeof value === "string" && (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function normalizeAuditSearchText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function csvDateBoundary(date: string, end: boolean): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const calendarDate = new Date(0);
  calendarDate.setUTCHours(0, 0, 0, 0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  if (
    calendarDate.getUTCFullYear() !== year
    || calendarDate.getUTCMonth() !== month - 1
    || calendarDate.getUTCDate() !== day
  ) return null;
  const value = new Date(`${date}T${end ? "23:59:59.999" : "00:00:00"}+01:00`).getTime();
  return Number.isFinite(value) ? value : null;
}

export function createItsmAuditExportHandler({
  resolveActor,
  loadAuditEvents,
  resolveNames,
}: AuditExportDependencies): RequestHandler {
  return async (req, res): Promise<void> => {
    const actor = await resolveActor(req, res);
    if (!actor || res.headersSent) return;
    try {
      requirePermission(actor, "exportAudit");
    } catch (error) {
      if (error instanceof ItsmAuthorizationError) {
        res.status(403).json({ error: error.message });
        return;
      }
      throw error;
    }

    const query = normalizeAuditSearchText(String(req.query.q ?? "").trim());
    const scope = String(req.query.scope ?? "Tous");
    const rawFrom = String(req.query.from ?? "");
    const rawTo = String(req.query.to ?? "");
    const from = csvDateBoundary(rawFrom, false);
    const to = csvDateBoundary(rawTo, true);
    if ((rawFrom && from === null) || (rawTo && to === null)) {
      res.status(400).json({ error: "La date de début ou de fin est invalide. Utilisez le format AAAA-MM-JJ avec une date réelle." });
      return;
    }

    let rawEvents: unknown[];
    try {
      rawEvents = await loadAuditEvents();
    } catch (error) {
      req.log?.error({ err: error }, "Failed to load ITSM audit for CSV export");
      res.status(503).json({ error: "Impossible de lire le journal d’activité. Réessayez plus tard." });
      return;
    }
    const records = rawEvents.filter((value): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object" && !Array.isArray(value)) && !isPrunedAuditEvent(value));
    const names = await namesFor(records, resolveNames, (error) => req.log?.warn({ err: error }, "Audit export continues without account names"));
    const nameOf = (id: unknown) => (typeof id === "string" ? names.get(id) : undefined) ?? "";
    const events = records
      .filter((event) => {
        if (scope !== "Tous" && event.scope !== scope) return false;
        const searchable = [
          event.action, event.actor, nameOf(event.actor), event.scope, event.time,
          event.targetUserId, nameOf(event.targetUserId), event.previousRole, event.nextRole,
          ...(Array.isArray(event.previousServiceIds) ? event.previousServiceIds : []),
          ...(Array.isArray(event.serviceIds) ? event.serviceIds : []),
        ].filter(Boolean).join(" ");
        if (query && !normalizeAuditSearchText(searchable).includes(query)) return false;
        const at = typeof event.at === "string" ? Date.parse(event.at) : Number.NaN;
        if (from !== null && (!Number.isFinite(at) || at < from)) return false;
        if (to !== null && (!Number.isFinite(at) || at > to)) return false;
        return true;
      });
    const rows = [
      ["Identifiant", "Action", "Acteur", "Nom de l’acteur", "Compte cible", "Nom du compte cible", "Ancien rôle", "Nouveau rôle", "Ancien périmètre", "Nouveau périmètre", "Périmètre", "Horodatage ISO", "Heure enregistrée", "Séquence", "Empreinte précédente", "Empreinte"],
      ...events.map((event) => [
        event.id, event.action, event.actor, nameOf(event.actor),
        event.targetUserId, nameOf(event.targetUserId),
        event.previousRole, event.nextRole,
        Array.isArray(event.previousServiceIds) ? event.previousServiceIds.join(", ") : "",
        Array.isArray(event.serviceIds) ? event.serviceIds.join(", ") : "",
        event.scope, event.at, event.time, event.seq, event.prevHash, event.hash,
      ]),
    ];
    const csv = `\uFEFF${rows.map((rowValues) => rowValues.map(csvCell).join(";")).join("\r\n")}\r\n`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="journal-anif-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  };
}

/**
 * Verify the journal hash chain. Same audience as the export (N1, N3, N5).
 * Returns only seals and counts, never event content.
 */
export function createItsmAuditIntegrityHandler({
  resolveActor,
  loadAuditEvents,
  loadArchivedSeals = async () => null,
  now = () => new Date(),
}: Pick<AuditExportDependencies, "resolveActor" | "loadAuditEvents"> & {
  /** Seals kept by the append-only PostgreSQL archive; null when it is not installed. */
  loadArchivedSeals?: () => Promise<ArchivedSeal[] | null>;
  now?: () => Date;
}): RequestHandler {
  return async (req, res): Promise<void> => {
    const actor = await resolveActor(req, res);
    if (!actor || res.headersSent) return;
    try {
      requirePermission(actor, "exportAudit");
    } catch (error) {
      if (error instanceof ItsmAuthorizationError) {
        res.status(403).json({ error: error.message });
        return;
      }
      throw error;
    }
    let events: unknown[];
    let archived: ArchivedSeal[] | null;
    try {
      [events, archived] = await Promise.all([loadAuditEvents(), loadArchivedSeals()]);
    } catch (error) {
      req.log?.error({ err: error }, "Failed to load ITSM audit for integrity check");
      res.status(503).json({ error: "Impossible de lire le journal d’activité. Réessayez plus tard." });
      return;
    }
    const report = verifyAuditChain(events);
    if (report.status === "broken") {
      req.log?.error({ alert: "itsm_audit_chain_broken", firstBreak: report.firstBreak }, "ITSM audit hash chain is broken");
    }
    const archive = compareWithArchive(events, archived);
    if (archive.status === "diverged") {
      req.log?.error({ alert: "itsm_audit_archive_diverged", firstMismatch: archive.firstMismatch }, "ITSM audit journal differs from its append-only archive");
    }
    // A journal that lost or changed an archived seal gives no checkpoint, even with a coherent chain.
    const seals = report.status === "intact" && archive.status !== "diverged" ? orderedSeals(events) : [];
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ...report,
      archive,
      merkle: seals.length ? { root: merkleRoot(seals), size: seals.length } : null,
      checkedAt: now().toISOString(),
    });
  };
}

/** Seals of the journal in sequence order (the Merkle leaves). */
export function orderedSeals(events: readonly unknown[]): string[] {
  return events
    .filter((event): event is Record<string, unknown> => Boolean(event && typeof event === "object" && !Array.isArray(event)))
    .sort((left, right) => Number(left.seq) - Number(right.seq))
    .map((event) => event.hash)
    .filter(isSeal);
}

/**
 * Inclusion proof of one journal event in the Merkle tree of the first
 * `treeSize` events (default: the whole journal). An auditor who kept the root
 * and size of an earlier checkpoint asks for that size and checks the proof
 * against the root they kept. Same audience as the export (N1, N3, N5);
 * returns seals only, never event content.
 */
export function createItsmAuditProofHandler({
  resolveActor,
  loadAuditEvents,
}: Pick<AuditExportDependencies, "resolveActor" | "loadAuditEvents">): RequestHandler {
  return async (req, res): Promise<void> => {
    const actor = await resolveActor(req, res);
    if (!actor || res.headersSent) return;
    try {
      requirePermission(actor, "exportAudit");
    } catch (error) {
      if (error instanceof ItsmAuthorizationError) {
        res.status(403).json({ error: error.message });
        return;
      }
      throw error;
    }
    const reference = String(req.query.event ?? "").trim();
    const rawSize = req.query.treeSize === undefined ? "" : String(req.query.treeSize);
    if (!reference || reference.length > 120 || (rawSize && !/^[1-9]\d{0,8}$/u.test(rawSize))) {
      res.status(400).json({ error: "Indiquez l’identifiant ou le numéro de séquence d’un événement, et une taille d’arbre entière." });
      return;
    }
    let events: unknown[];
    try {
      events = await loadAuditEvents();
    } catch (error) {
      req.log?.error({ err: error }, "Failed to load ITSM audit for an inclusion proof");
      res.status(503).json({ error: "Impossible de lire le journal d’activité. Réessayez plus tard." });
      return;
    }
    const report = verifyAuditChain(events);
    if (report.status !== "intact") {
      res.status(409).json({ error: "La chaîne du journal n’est pas intacte : aucune preuve ne peut être établie." });
      return;
    }
    const seals = orderedSeals(events);
    const records = events.filter((event): event is Record<string, unknown> => Boolean(event && typeof event === "object"));
    const target = /^\d+$/u.test(reference)
      ? records.find((event) => event.seq === Number(reference))
      : records.find((event) => event.id === reference);
    if (!target) {
      res.status(404).json({ error: "Aucun événement scellé ne porte cet identifiant ou ce numéro." });
      return;
    }
    const seq = target.seq as number;
    const treeSize = rawSize ? Number(rawSize) : seals.length;
    if (treeSize > seals.length || seq > treeSize) {
      res.status(400).json({ error: `La taille d’arbre doit être comprise entre ${seq} et ${seals.length}.` });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      eventId: typeof target.id === "string" ? target.id : null,
      seq,
      seal: target.hash,
      treeSize,
      root: merkleRoot(seals, treeSize),
      proof: merkleInclusionProof(seals, seq - 1, treeSize),
    });
  };
}

/**
 * Journal feed for a SIEM collector: NDJSON, one event per line (ECS field
 * names), oldest first, after the sequence `after`. Headers give the cursor for
 * the next poll and the chain state, so the collector raises its own alert when
 * the chain breaks. Same audience as the export (N1, N3, N5).
 */
export function createItsmAuditSiemHandler({
  resolveActor,
  loadAuditEvents,
}: Pick<AuditExportDependencies, "resolveActor" | "loadAuditEvents">): RequestHandler {
  return async (req, res): Promise<void> => {
    const actor = await resolveActor(req, res);
    if (!actor || res.headersSent) return;
    try {
      requirePermission(actor, "exportAudit");
    } catch (error) {
      if (error instanceof ItsmAuthorizationError) {
        res.status(403).json({ error: error.message });
        return;
      }
      throw error;
    }
    const rawAfter = req.query.after === undefined ? "0" : String(req.query.after);
    const rawLimit = req.query.limit === undefined ? "500" : String(req.query.limit);
    if (!/^(0|[1-9]\d{0,8})$/u.test(rawAfter) || !/^[1-9]\d{0,3}$/u.test(rawLimit) || Number(rawLimit) > 1000) {
      res.status(400).json({ error: "« after » doit être un numéro de séquence (0 au départ) et « limit » un entier de 1 à 1000." });
      return;
    }
    let events: unknown[];
    try {
      events = await loadAuditEvents();
    } catch (error) {
      req.log?.error({ err: error }, "Failed to load ITSM audit for the SIEM feed");
      res.status(503).json({ error: "Impossible de lire le journal d’activité. Réessayez plus tard." });
      return;
    }
    const chain = verifyAuditChain(events);
    if (chain.status === "broken") {
      req.log?.error({ alert: "itsm_audit_chain_broken", firstBreak: chain.firstBreak }, "ITSM audit hash chain is broken");
    }
    const page = siemPage(events, Number(rawAfter), Number(rawLimit));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("X-ANIF-Next-After", String(page.next));
    res.setHeader("X-ANIF-Journal-Head", String(page.head));
    res.setHeader("X-ANIF-Chain-Status", chain.status);
    res.send(page.lines.length ? `${page.lines.join("\n")}\n` : "");
  };
}

type TimestampDependencies = Pick<AuditExportDependencies, "resolveActor" | "loadAuditEvents"> & {
  tsaUrl?: string;
  trustedCerts?: Certificate[];
  fetchImpl?: typeof fetch;
  /** Inside the workspace lock: journal the token if the first `size` seals still give `root`. */
  appendTimestamp?: (entry: {
    actorId: string; size: number; root: string; token: string; verification: TimestampVerification;
  }) => Promise<"saved" | "changed">;
};

const timestampEvents = (events: readonly unknown[]) => events
  .filter((event): event is Record<string, unknown> => Boolean(event && typeof event === "object")
    && (event as Record<string, unknown>).type === ITSM_AUDIT_TIMESTAMP_TYPE);

async function permitted(req: Request, res: Response, resolveActor: AuditExportDependencies["resolveActor"], permission: "exportAudit" | "timestampAudit") {
  const actor = await resolveActor(req, res);
  if (!actor || res.headersSent) return null;
  try {
    requirePermission(actor, permission);
  } catch (error) {
    if (error instanceof ItsmAuthorizationError) {
      res.status(403).json({ error: error.message });
      return null;
    }
    throw error;
  }
  return actor;
}

/**
 * RFC 3161 timestamps of the journal, re-verified at each call: TSA signature,
 * imprint of the checkpoint statement, and whether the first `size` events of
 * today's journal still give the root that was timestamped. N1, N3, N5.
 */
export function createItsmAuditTimestampListHandler({
  resolveActor, loadAuditEvents, trustedCerts = [], tsaUrl,
}: TimestampDependencies): RequestHandler {
  return async (req, res): Promise<void> => {
    const actor = await permitted(req, res, resolveActor, "exportAudit");
    if (!actor) return;
    let events: unknown[];
    try {
      events = await loadAuditEvents();
    } catch (error) {
      req.log?.error({ err: error }, "Failed to load ITSM audit for timestamps");
      res.status(503).json({ error: "Impossible de lire le journal d’activité. Réessayez plus tard." });
      return;
    }
    const seals = verifyAuditChain(events).status === "intact" ? orderedSeals(events) : [];
    const items = [];
    for (const event of timestampEvents(events).slice(0, 20)) {
      const checkpoint = (event.checkpoint ?? {}) as { size?: unknown; root?: unknown };
      const size = Number(checkpoint.size);
      const root = String(checkpoint.root ?? "");
      const tsa = (event.tsa ?? {}) as Record<string, unknown>;
      const statement = checkpointStatement(size, root);
      const verification = typeof event.token === "string"
        ? await verifyTimestamp(Buffer.from(event.token, "base64"), Buffer.from(statement), { trustedCerts })
        : { valid: false, chainVerified: false, genTime: null, serial: null, policy: null, tsaSubject: null, problem: "Jeton absent." };
      const journalUnchanged = Number.isSafeInteger(size) && size >= 1 && size <= seals.length && merkleRoot(seals, size) === root;
      items.push({
        id: String(event.id),
        at: typeof event.at === "string" ? event.at : null,
        actor: typeof event.actor === "string" ? event.actor : null,
        size, root, statement,
        tsaUrl: typeof tsa.url === "string" ? tsa.url : null,
        genTime: verification.genTime,
        serial: verification.serial,
        policy: verification.policy,
        tsaSubject: verification.tsaSubject,
        valid: verification.valid,
        chainVerified: verification.chainVerified,
        journalUnchanged,
        problem: verification.problem ?? (journalUnchanged ? null : "Les événements horodatés ne donnent plus la même racine : le journal a été réécrit depuis."),
      });
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ configured: Boolean(tsaUrl), trustedRoots: trustedCerts.length, timestamps: items });
  };
}

/** Ask the configured TSA to timestamp today's checkpoint, then journal the token (N1, N3). */
export function createItsmAuditTimestampHandler({
  resolveActor, loadAuditEvents, tsaUrl, trustedCerts = [], fetchImpl = fetch, appendTimestamp,
}: TimestampDependencies): RequestHandler {
  return async (req, res): Promise<void> => {
    const actor = await permitted(req, res, resolveActor, "timestampAudit");
    if (!actor) return;
    if (!tsaUrl || !appendTimestamp) {
      res.status(503).json({ error: "Aucune autorité d’horodatage n’est configurée (ITSM_TSA_URL)." });
      return;
    }
    let events: unknown[];
    try {
      events = await loadAuditEvents();
    } catch (error) {
      req.log?.error({ err: error }, "Failed to load ITSM audit before timestamping");
      res.status(503).json({ error: "Impossible de lire le journal d’activité. Réessayez plus tard." });
      return;
    }
    if (verifyAuditChain(events).status !== "intact") {
      res.status(409).json({ error: "La chaîne du journal n’est pas intacte : elle ne peut pas être horodatée." });
      return;
    }
    const seals = orderedSeals(events);
    const size = seals.length;
    const root = merkleRoot(seals);
    const statement = Buffer.from(checkpointStatement(size, root));
    const request = buildTimestampRequest(createHash("sha256").update(statement).digest());
    let token: Buffer;
    try {
      token = await requestTimestamp(tsaUrl, request, fetchImpl);
    } catch (error) {
      req.log?.warn({ err: error, alert: "itsm_audit_timestamp_failed" }, "RFC 3161 timestamp authority unavailable");
      res.status(502).json({ error: "L’autorité d’horodatage n’a pas répondu. Réessayez plus tard." });
      return;
    }
    const verification = await verifyTimestamp(token, statement, { nonce: requestNonce(request), trustedCerts });
    if (!verification.valid) {
      req.log?.warn({ alert: "itsm_audit_timestamp_rejected", problem: verification.problem }, "RFC 3161 token rejected");
      res.status(502).json({ error: `Jeton d’horodatage refusé : ${verification.problem}` });
      return;
    }
    const outcome = await appendTimestamp({ actorId: actor.id, size, root, token: token.toString("base64"), verification });
    if (outcome === "changed") {
      res.status(409).json({ error: "Le journal a changé pendant l’horodatage. Relancez la demande." });
      return;
    }
    res.status(201).json({ size, root, genTime: verification.genTime, serial: verification.serial, tsaSubject: verification.tsaSubject, chainVerified: verification.chainVerified });
  };
}

/** Download one stored token (DER), to check it with `openssl ts -verify`. N1, N3, N5. */
export function createItsmAuditTimestampTokenHandler({ resolveActor, loadAuditEvents }: TimestampDependencies): RequestHandler {
  return async (req, res): Promise<void> => {
    const actor = await permitted(req, res, resolveActor, "exportAudit");
    if (!actor) return;
    const id = String(req.params.id ?? "");
    let events: unknown[];
    try {
      events = await loadAuditEvents();
    } catch (error) {
      req.log?.error({ err: error }, "Failed to load ITSM audit for a timestamp token");
      res.status(503).json({ error: "Impossible de lire le journal d’activité. Réessayez plus tard." });
      return;
    }
    const event = timestampEvents(events).find((item) => item.id === id);
    if (!event || typeof event.token !== "string") {
      res.status(404).json({ error: "Aucun horodatage ne porte cet identifiant." });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/timestamp-reply");
    res.setHeader("Content-Disposition", `attachment; filename="journal-anif-horodatage-${id.replace(/[^A-Za-z0-9-]/gu, "")}.tsr"`);
    res.send(Buffer.from(event.token, "base64"));
  };
}
