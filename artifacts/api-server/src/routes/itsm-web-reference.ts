import {
  AddItsmTicketWebReferenceBody,
  AddItsmTicketWebReferenceParams,
  AddItsmTicketWebReferenceResponse,
} from "@workspace/api-zod";
import { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import {
  normalizeWebReferenceUrl,
  WebReferenceScrapeError,
  type ScrapePage,
} from "../lib/firecrawl.ts";
import {
  appendTicketWebReference,
  assertCanAddWebReference,
  WebReferenceRejectedError,
} from "../lib/itsm-web-reference.ts";
import type { WorkspaceActor } from "../lib/itsm-workspace.ts";

type JsonRecord = Record<string, unknown>;

export const WEB_REFERENCE_RATE_LIMIT = 10;
export const WEB_REFERENCE_RATE_WINDOW_MS = 10 * 60 * 1000;

export type WebReferenceDependencies = {
  resolveActor: (req: Request, res: Response) => Promise<WorkspaceActor | null>;
  /** null when Firecrawl is not configured: the route then answers 503. */
  scrapePage: ScrapePage | null;
  loadStore: () => Promise<JsonRecord>;
  withLock: <T>(operation: (
    store: JsonRecord,
    saveStore: (nextStore: JsonRecord) => Promise<number>,
  ) => Promise<T>) => Promise<T>;
  now?: () => Date;
};

/** In-memory, per-account limit: each scrape spends Firecrawl credits. */
export function createWebReferenceRateLimiter(limit = WEB_REFERENCE_RATE_LIMIT, windowMs = WEB_REFERENCE_RATE_WINDOW_MS) {
  const calls = new Map<string, number[]>();
  return (actorId: string, now: number): boolean => {
    const recent = (calls.get(actorId) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= limit) {
      calls.set(actorId, recent);
      return false;
    }
    recent.push(now);
    calls.set(actorId, recent);
    return true;
  };
}

export function createItsmWebReferenceHandler(dependencies: WebReferenceDependencies) {
  const allow = createWebReferenceRateLimiter();
  const now = dependencies.now ?? (() => new Date());
  return async (req: Request, res: Response): Promise<void> => {
    const actor = await dependencies.resolveActor(req, res);
    if (!actor || res.headersSent) return;

    const parsedParams = AddItsmTicketWebReferenceParams.safeParse(req.params);
    const parsedBody = AddItsmTicketWebReferenceBody.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      res.status(400).json({ error: "Référence web invalide : indiquez une adresse https et, au besoin, une note de 500 caractères maximum." });
      return;
    }
    if (!dependencies.scrapePage) {
      res.status(503).json({ error: "Les références web ne sont pas configurées sur ce pilote (FIRECRAWL_API_KEY absente)." });
      return;
    }
    const url = normalizeWebReferenceUrl(parsedBody.data.url);
    if (!url) {
      res.status(400).json({ error: "Seules les pages publiques en https sont acceptées (pas d’adresse IP, de nom interne ni d’identifiants dans l’adresse)." });
      return;
    }
    const { ticketId } = parsedParams.data;
    const note = parsedBody.data.note?.trim() || null;

    try {
      // Authorize before fetching: a refused request must not spend scraping credits.
      assertCanAddWebReference(await dependencies.loadStore(), ticketId, actor);
      if (!allow(actor.id, now().getTime())) {
        res.status(429).json({ error: "Trop de références web en peu de temps. Réessayez dans quelques minutes." });
        return;
      }
      const page = await dependencies.scrapePage(url);
      const outcome = await dependencies.withLock(async (store, saveStore) => {
        const appended = appendTicketWebReference(store, ticketId, { ...page, url, note }, actor, now());
        const version = await saveStore(appended.store);
        return { update: appended.update, version, title: page.title };
      });
      res.json(AddItsmTicketWebReferenceResponse.parse({
        ticketId,
        url,
        title: outcome.title,
        update: outcome.update,
        version: outcome.version,
      }));
    } catch (error) {
      if (error instanceof WebReferenceRejectedError || error instanceof WebReferenceScrapeError) {
        if (error instanceof WebReferenceScrapeError) {
          req.log?.warn({ actorId: actor.id, ticketId, status: error.status }, "Web reference scrape failed");
        }
        res.status(error.status).json({ error: error.message });
        return;
      }
      req.log?.error({ err: error, actorId: actor.id, ticketId }, "Could not record ticket web reference");
      res.status(503).json({ error: "Impossible d’enregistrer la référence web dans l’espace ITSM." });
    }
  };
}

export function createItsmWebReferenceRouter(
  dependencies: WebReferenceDependencies,
  authMiddleware: RequestHandler,
): IRouter {
  const webReferenceRouter: IRouter = Router();
  webReferenceRouter.post(
    "/itsm/tickets/:ticketId/web-reference",
    authMiddleware,
    createItsmWebReferenceHandler(dependencies),
  );
  return webReferenceRouter;
}
