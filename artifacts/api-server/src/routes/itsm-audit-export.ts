import type { Request, RequestHandler, Response } from "express";
import {
  ItsmAuthorizationError,
  requirePermission,
} from "../lib/itsm-rbac.ts";
import type { WorkspaceActor } from "../lib/itsm-workspace.ts";

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
  if (typeof value === "string" && (/^[\s﻿]*[=+\-@]/u.test(text) || /^[\t\r\n]/u.test(text))) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function csvDateBoundary(date: string, end: boolean): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
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

    const rawEvents = await loadAuditEvents();
    const query = String(req.query.q ?? "").trim().toLocaleLowerCase("fr");
    const scope = String(req.query.scope ?? "Tous");
    const from = csvDateBoundary(String(req.query.from ?? ""), false);
    const to = csvDateBoundary(String(req.query.to ?? ""), true);
    const records = rawEvents.filter((value): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object" && !Array.isArray(value)));
    const names = await namesFor(records, resolveNames, (error) => req.log?.warn({ err: error }, "Audit export continues without account names"));
    const nameOf = (id: unknown) => (typeof id === "string" ? names.get(id) : undefined) ?? "";
    const events = records
      .filter((event) => {
        if (scope !== "Tous" && event.scope !== scope) return false;
        if (query && [
          event.action, event.actor, nameOf(event.actor), event.scope, event.time,
          event.targetUserId, nameOf(event.targetUserId), event.previousRole, event.nextRole,
          ...(Array.isArray(event.previousServiceIds) ? event.previousServiceIds : []),
          ...(Array.isArray(event.serviceIds) ? event.serviceIds : []),
        ].filter(Boolean).join(" ").toLocaleLowerCase("fr").includes(query) === false) return false;
        const at = typeof event.at === "string" ? Date.parse(event.at) : Number.NaN;
        if (from !== null && (!Number.isFinite(at) || at < from)) return false;
        if (to !== null && (!Number.isFinite(at) || at > to)) return false;
        return true;
      });
    const rows = [
      ["Identifiant", "Action", "Acteur", "Nom de l’acteur", "Compte cible", "Nom du compte cible", "Ancien rôle", "Nouveau rôle", "Ancien périmètre", "Nouveau périmètre", "Périmètre", "Horodatage ISO"],
      ...events.map((event) => [
        event.id, event.action, event.actor, nameOf(event.actor),
        event.targetUserId, nameOf(event.targetUserId),
        event.previousRole, event.nextRole,
        Array.isArray(event.previousServiceIds) ? event.previousServiceIds.join(", ") : "",
        Array.isArray(event.serviceIds) ? event.serviceIds.join(", ") : "",
        event.scope, event.at,
      ]),
    ];
    const csv = `﻿${rows.map((rowValues) => rowValues.map(csvCell).join(";")).join("\r\n")}\r\n`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="journal-anif-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  };
}
