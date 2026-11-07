import type { Request, RequestHandler, Response } from "express";
import {
  ItsmAuthorizationError,
  requirePermission,
} from "../lib/itsm-rbac.ts";
import type { WorkspaceActor } from "../lib/itsm-workspace.ts";
import { isPrunedAuditEvent, verifyAuditChain } from "../lib/itsm-audit-chain.ts";

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
  now = () => new Date(),
}: Pick<AuditExportDependencies, "resolveActor" | "loadAuditEvents"> & { now?: () => Date }): RequestHandler {
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
    try {
      events = await loadAuditEvents();
    } catch (error) {
      req.log?.error({ err: error }, "Failed to load ITSM audit for integrity check");
      res.status(503).json({ error: "Impossible de lire le journal d’activité. Réessayez plus tard." });
      return;
    }
    const report = verifyAuditChain(events);
    if (report.status === "broken") {
      req.log?.error({ alert: "itsm_audit_chain_broken", firstBreak: report.firstBreak }, "ITSM audit hash chain is broken");
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...report, checkedAt: now().toISOString() });
  };
}
