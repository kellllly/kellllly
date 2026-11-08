import type { Request, Response } from "express";
import type { WorkspaceActor } from "../lib/itsm-workspace.ts";

/**
 * Lists the accounts whose Clerk role or services differ from the latest role
 * event of the journal, so an N1 can verify them and record an attestation.
 * Read-only; the caller passes an actor resolver that re-reads the role from Clerk.
 */
export function createRoleReconciliationHandler(dependencies: {
  resolveActor: (req: Request, res: Response) => Promise<WorkspaceActor | null>;
  scan: () => Promise<unknown>;
  serialize?: (body: { checkedAt: string; findings: unknown }) => unknown;
  now?: () => Date;
}) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = await dependencies.resolveActor(req, res);
    if (!actor || res.headersSent) return;
    if (actor.role !== "N1") {
      res.status(403).json({ error: "Le contrôle des habilitations est réservé aux N1." });
      return;
    }
    try {
      const body = { checkedAt: (dependencies.now?.() ?? new Date()).toISOString(), findings: await dependencies.scan() };
      res.setHeader("Cache-Control", "no-store");
      res.json(dependencies.serialize ? dependencies.serialize(body) : body);
    } catch (error) {
      req.log.error({ err: error, actorId: actor.id }, "Could not compare ITSM roles with the journal");
      res.status(503).json({ error: "Impossible de comparer les habilitations avec le journal pour le moment." });
    }
  };
}
