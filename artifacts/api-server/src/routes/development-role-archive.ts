import { createHash, timingSafeEqual } from "node:crypto";
import express, { Router, type IRouter, type ErrorRequestHandler } from "express";
import {
  AppendDevelopmentRoleArchiveBody,
  AppendDevelopmentRoleArchiveResponse,
  type DevelopmentRoleArchiveEnvelope,
} from "@workspace/api-zod";

export interface DevelopmentArchiveRepository {
  check(): Promise<void>;
  append(envelope: DevelopmentRoleArchiveEnvelope): Promise<"created" | "duplicate" | "conflict">;
}

const envelopeSchema = AppendDevelopmentRoleArchiveBody.extend({
  event: AppendDevelopmentRoleArchiveBody.shape.event.strict(),
}).strict();
const hash = (value: string) => createHash("sha256").update(value).digest();

export function createDevelopmentRoleArchiveRouter(options: {
  authorization: string;
  repository: DevelopmentArchiveRepository;
  onStorageError?: () => void;
}): IRouter {
  const router = Router();
  const expected = hash(options.authorization);
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!timingSafeEqual(expected, hash(req.get("authorization") ?? ""))) {
      res.status(401).json({ error: "Identifiant d’archive invalide." });
      return;
    }
    next();
  });
  router.use(express.json({ limit: "64kb", strict: true }));
  router.head("/", async (_req, res): Promise<void> => {
    try {
      await options.repository.check();
      res.status(204).end();
    } catch {
      options.onStorageError?.();
      res.status(503).end();
    }
  });
  router.post("/", async (req, res): Promise<void> => {
    const parsed = envelopeSchema.safeParse(req.body);
    if (!parsed.success || req.get("idempotency-key") !== parsed.data.event.id
      || !Number.isFinite(Date.parse(parsed.data.event.at))) {
      res.status(400).json({ error: "Événement ou clé d’idempotence invalide." });
      return;
    }
    try {
      const outcome = await options.repository.append(parsed.data);
      if (outcome === "conflict") {
        res.status(409).json({ error: "Cet identifiant désigne déjà un autre événement." });
        return;
      }
      res.json(AppendDevelopmentRoleArchiveResponse.parse({
        eventId: parsed.data.event.id,
        duplicate: outcome === "duplicate",
      }));
    } catch {
      options.onStorageError?.();
      res.status(503).json({ error: "Réception non confirmée dans le stockage de développement." });
    }
  });
  router.all("/", (_req, res) => {
    res.set("Allow", "HEAD, POST").status(405).end();
  });
  const parseError: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error?.type === "entity.too.large" ? 413 : 400)
      .json({ error: "Corps JSON invalide ou trop volumineux." });
  };
  router.use(parseError);
  return router;
}
