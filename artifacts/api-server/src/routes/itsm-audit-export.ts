import type { Request, RequestHandler, Response } from "express";
import {
  ItsmAuthorizationError,
  requirePermission,
} from "../lib/itsm-rbac.ts";
import type { WorkspaceActor } from "../lib/itsm-workspace.ts";

type AuditExportDependencies = {
  resolveActor: (req: Request, res: Response) => Promise<WorkspaceActor | null>;
  loadAuditEvents: () => Promise<unknown[]>;
};

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
    const events = rawEvents.filter((value): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object" && !Array.isArray(value)))
      .filter((event) => {
        if (scope !== "Tous" && event.scope !== scope) return false;
        if (query && [
          event.action, event.actor, event.scope, event.time, event.targetUserId,
          event.previousRole, event.nextRole,
          ...(Array.isArray(event.previousServiceIds) ? event.previousServiceIds : []),
          ...(Array.isArray(event.serviceIds) ? event.serviceIds : []),
        ].filter(Boolean).join(" ").toLocaleLowerCase("fr").includes(query) === false) return false;
        const at = typeof event.at === "string" ? Date.parse(event.at) : Number.NaN;
        if (from !== null && (!Number.isFinite(at) || at < from)) return false;
        if (to !== null && (!Number.isFinite(at) || at > to)) return false;
        return true;
      });
    const rows = [
      ["Identifiant", "Action", "Acteur", "Compte cible", "Ancien rôle", "Nouveau rôle", "Ancien périmètre", "Nouveau périmètre", "Périmètre", "Horodatage ISO"],
      ...events.map((event) => [
        event.id, event.action, event.actor, event.targetUserId,
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
