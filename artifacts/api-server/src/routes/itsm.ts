import { clerkClient, getAuth } from "@clerk/express";
import {
  AssignItsmRoleBody,
  AssignItsmRoleParams,
  AssignItsmRoleResponse,
  CheckItsmRoleArchiveResponse,
  AttestItsmRoleParams,
  AttestItsmRoleBody,
  AttestItsmRoleResponse,
  GetItsmWorkspaceResponse,
  GetItsmWorkspaceVersionResponse,
  GetItsmSessionMarkerResponse,
  PostItsmTemporaryMessageBody,
  PostItsmTemporaryMessageResponse,
  GetItsmPeopleResponse,
  GetItsmContactsResponse,
  GetItsmRoleReconciliationResponse,
  GetItsmUserDirectoryQueryParams,
  GetItsmUserDirectoryResponse,
  ImportItsmExamplesBody,
  ImportItsmExamplesResponse,
  SaveItsmWorkspaceBody,
  SaveItsmWorkspaceResponse,
} from "@workspace/api-zod";
import { db, itsmWorkspaceTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { createRoleJournalCache, decideJournaledRole } from "../lib/itsm-role-journal";
import { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import { logger } from "../lib/logger";
import { reportItsmRoleArchiveUnavailable } from "../lib/itsm-role-archive-monitor";
import { notifyItsmRoleArchiveAlert } from "../lib/itsm-role-archive-slack-alerts";
import {
  mergeLocalExamples,
  checkItsmRoleArchiveConnection,
  findItsmRoleReconciliationIssues,
  isDevelopmentDatabaseRoleArchiveEnabled,
  ItsmRoleArchiveUnavailableError,
  recordItsmRoleAttestation,
  publishItsmRoleChangeToArchive,
  recordItsmRoleChange,
  saveWorkspaceAtVersion,
  userStoreView,
  workspaceVersionConflictResponse,
  type WorkspaceActor,
  type VersionedWorkspaceSave,
  type ItsmRoleSnapshot,
  type ItsmRoleChangeArchiveEvent,
  sealItsmWorkspaceAudit,
  ensureSupportServiceChannels,
  recordItsmSlaBreaches,
  purgeExpiredMessages,
  postTemporaryChannelMessage,
} from "../lib/itsm-workspace";
import type { SlaBreach, SlaEscalation } from "../lib/itsm-sla";
import { toItsmDirectoryAccount } from "../lib/itsm-user-directory";
import { createActorCache } from "../lib/itsm-actor-cache";
import { CONTACT_SEARCH_MAX_LENGTH, contactsFromClerkUsers, createPeopleDirectory, MAX_PEOPLE_PER_REQUEST, parsePeopleIds } from "../lib/itsm-people";
import {
  publishItsmRoleDirectoryEvent,
  subscribeToItsmRoleDirectoryEvents,
  type ItsmRoleDirectoryEvent,
} from "../lib/itsm-role-directory-events";
import {
  canChangeItsmRole,
  isBootstrapAdmin,
  isItsmRole,
  ItsmAuthorizationError,
  metadataForItsmBootstrap,
  metadataForItsmRoleChange,
  itsmRoleName,
  requirePermission,
  type ItsmRole,
} from "../lib/itsm-rbac";
import { createAuditRateLimit } from "../lib/itsm-rate-limit";
import { createItsmAuditExportHandler, createItsmAuditIntegrityHandler, createItsmAuditProofHandler, createItsmAuditSiemHandler } from "./itsm-audit-export";
import { createRoleReconciliationHandler } from "./itsm-role-reconciliation";

import { developmentRoleArchiveEnabled } from "../lib/development-role-archive-config";

export { publishItsmRoleDirectoryEvent };

const router: IRouter = Router();
const WORKSPACE_ID = "anif-pilot";

export async function checkItsmRoleArchiveAvailability(): Promise<void> {
  if (!isDevelopmentDatabaseRoleArchiveEnabled()) {
    await checkItsmRoleArchiveConnection();
    return;
  }
  try {
    await db.select({ id: itsmWorkspaceTable.id }).from(itsmWorkspaceTable).limit(1);
  } catch {
    throw new ItsmRoleArchiveUnavailableError(
      "La base de développement est indisponible pour le journal des habilitations.",
    );
  }
}

export async function withAdminChangeLock<T>(
  operation: (
    store: Record<string, unknown>,
    saveStore: (nextStore: Record<string, unknown>) => Promise<void>,
  ) => Promise<T>,
  workspaceId = WORKSPACE_ID,
): Promise<T> {
  // Drop the cached role journal once the transaction is committed, too.
  return db.transaction(async (tx) => {
    await tx.insert(itsmWorkspaceTable).values({
      id: workspaceId, version: 0, store: {}, importedUsers: [],
    }).onConflictDoNothing();
    const [row] = await tx.select().from(itsmWorkspaceTable)
      .where(eq(itsmWorkspaceTable.id, workspaceId)).for("update");
    if (!row) throw new Error("Espace ITSM indisponible.");
    const saveStore = async (nextStore: Record<string, unknown>) => {
      const [updated] = await tx.update(itsmWorkspaceTable).set({
        store: nextStore,
        version: row.version + 1,
        updatedAt: new Date(),
      }).where(eq(itsmWorkspaceTable.id, workspaceId)).returning();
      if (!updated) throw new Error("Impossible d’enregistrer le journal d’habilitation.");
      roleJournal.invalidate();
    };
    return operation(row.store, saveStore);
  }).finally(() => roleJournal.invalidate());
}

/** Seal a journal written before the hash chain existed, without waiting for a save. */
export async function sealStoredAuditJournal(): Promise<boolean> {
  return withAdminChangeLock(async (store, saveStore) => {
    const sealed = sealItsmWorkspaceAudit(store);
    if (!sealed) return false;
    await saveStore(sealed);
    return true;
  });
}

/** Opens the announcements channel and the support services room if missing. */
export async function ensureSupportServiceChannelsNow(): Promise<boolean> {
  return withAdminChangeLock(async (store, saveStore) => {
    const next = ensureSupportServiceChannels(store);
    if (!next) return false;
    await saveStore(next);
    return true;
  });
}

/** Journal the SLA breaches due now; writes only when there is a new one. */
export async function recordSlaBreachesNow(): Promise<{ breaches: SlaBreach[]; escalations: SlaEscalation[] }> {
  return withAdminChangeLock(async (store, saveStore) => {
    const { store: next, breaches, escalations } = recordItsmSlaBreaches(store);
    if (breaches.length || escalations.length) await saveStore(next);
    return { breaches, escalations };
  });
}

/** Erase expired ephemeral messages; writes only when one has expired. */
export async function purgeExpiredMessagesNow(): Promise<number> {
  return withAdminChangeLock(async (store, saveStore) => {
    const { store: next, count } = purgeExpiredMessages(store);
    if (count) await saveStore(next);
    return count;
  });
}

export async function scanItsmRoleReconciliation() {
  // This read-only comparison reports current state only; it cannot reconstruct how an unjournaled role was granted.
  const accounts: ItsmRoleSnapshot[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const page = await clerkClient.users.getUserList({ limit, offset });
    for (const user of page.data) {
      const role = user.publicMetadata.itsmRole;
      if (typeof role === "string" && role.length > 0) {
        const serviceIds = Array.isArray(user.publicMetadata.itsmServiceIds)
          ? user.publicMetadata.itsmServiceIds.filter((id): id is string => typeof id === "string")
          : [];
        accounts.push({ id: user.id, role, serviceIds });
      }
    }
    offset += page.data.length;
    if (offset >= page.totalCount || page.data.length === 0) break;
  }

  const [row] = await db.select().from(itsmWorkspaceTable)
    .where(eq(itsmWorkspaceTable.id, WORKSPACE_ID));
  return findItsmRoleReconciliationIssues(accounts, row?.store?.audit);
}

async function activeN1Ids(): Promise<string[]> {
  const ids = new Set<string>();
  let offset = 0;
  const limit = 100;
  for (;;) {
    const page = await clerkClient.users.getUserList({ limit, offset });
    for (const user of page.data) {
      // An N1 counts only if the journal says so (a Clerk-only N1 must not
      // let the real last N1 be revoked).
      const latest = await roleJournal.latest(user.id);
      const decision = decideJournaledRole({ role: user.publicMetadata.itsmRole, serviceIds: user.publicMetadata.itsmServiceIds }, latest);
      if (decision.kind === "granted" && decision.role === "N1") ids.add(user.id);
    }
    offset += page.data.length;
    if (offset >= page.totalCount || page.data.length === 0) break;
  }
  return [...ids];
}

router.use("/itsm", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  next();
});

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Authentification requise." });
    return;
  }
  next();
};

type RoleArchiveCheckDependencies = {
  resolveActor: typeof actorFor;
  checkArchiveConnection: typeof checkItsmRoleArchiveConnection;
  now: () => Date;
};

function createRoleArchiveCheckHandler(dependencies: RoleArchiveCheckDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = await dependencies.resolveActor(req, res);
    if (!actorOrReply(req, res, actor)) return;
    if (actor.role !== "N1") {
      res.status(403).json({ error: "Le contrôle de l’archive des habilitations est réservé aux N1." });
      return;
    }
    try {
      await dependencies.checkArchiveConnection();
      res.json(CheckItsmRoleArchiveResponse.parse({
        status: "available",
        message: developmentRoleArchiveEnabled()
          ? "L’archive de développement répond. Son stockage reste dans le même environnement, sans garantie d’indépendance ni d’immutabilité."
          : "L’archive répond à l’adresse configurée.",
        checkedAt: dependencies.now().toISOString(),
      }));
    } catch (error) {
      const message = error instanceof ItsmRoleArchiveUnavailableError
        ? error.message
        : "Impossible de vérifier la connexion à l’archive.";
      req.log.warn({ err: error, actorId: actor.id }, "External role archive connection check failed");
      res.status(503).json({
        error: message,
        checkedAt: dependencies.now().toISOString(),
      });
    }
  };
}

export function createItsmRoleArchiveCheckRouter(
  overrides: Partial<RoleArchiveCheckDependencies> = {},
  authMiddleware: RequestHandler = requireAuth,
): IRouter {
  const archiveCheckRouter: IRouter = Router();
  archiveCheckRouter.post("/itsm/role-archive/check", authMiddleware, createRoleArchiveCheckHandler({
    resolveActor: freshActorFor,
    checkArchiveConnection: checkItsmRoleArchiveAvailability,
    now: () => new Date(),
    ...overrides,
  }));
  return archiveCheckRouter;
}

type BootstrapUser = Awaited<ReturnType<typeof clerkClient.users.getUser>>;

type BootstrapDependencies = {
  getUser: (userId: string) => Promise<BootstrapUser>;
  updateUserMetadata: (
    userId: string,
    metadata: { publicMetadata: Record<string, unknown> },
  ) => Promise<unknown>;
  archiveRoleChange: (event: ItsmRoleChangeArchiveEvent) => Promise<void>;
  reportArchiveUnavailable: () => void;
  withLock: typeof withAdminChangeLock;
};

export function createItsmBootstrapAdmin(dependencies: BootstrapDependencies) {
  return async (userId: string, configuredEmails: string | undefined): Promise<BootstrapUser> => {
    let recovery: { eventId: string | null; previousMetadata: Record<string, unknown> } | null = null;
    try {
      return await dependencies.withLock(async (workspaceStore, saveStore) => {
        const current = await dependencies.getUser(userId);
        if (current.publicMetadata.itsmRole != null || !isBootstrapAdmin(
          current.primaryEmailAddress?.emailAddress,
          current.primaryEmailAddress?.verification?.status,
          current.publicMetadata.itsmBootstrapCompleted === true,
          configuredEmails,
        )) return current;

        recovery = {
          eventId: null,
          previousMetadata: { ...current.publicMetadata },
        };
        const previousServiceIds = Array.isArray(current.publicMetadata.itsmServiceIds)
          ? current.publicMetadata.itsmServiceIds.filter((id): id is string => typeof id === "string")
          : [];
        await dependencies.updateUserMetadata(userId, {
          publicMetadata: metadataForItsmBootstrap(current.publicMetadata),
        });
        const nextStore = recordItsmRoleChange(workspaceStore, {
          actorId: "system:itsm-bootstrap",
          targetUserId: userId,
          previousRole: null,
          nextRole: "N1",
          previousServiceIds,
          serviceIds: [],
          scope: "Aucun accès → N1 (bootstrap initial)",
          origin: "bootstrap",
        });
        const roleChangeEvent = (nextStore.audit as ItsmRoleChangeArchiveEvent[])[0];
        recovery.eventId = roleChangeEvent.id;
        try {
          await dependencies.archiveRoleChange(roleChangeEvent);
        } catch {
          throw new ItsmRoleArchiveUnavailableError();
        }
        await saveStore(nextStore);
        return dependencies.getUser(userId);
      });
    } catch (error) {
      const recoveryState = recovery as { eventId: string | null; previousMetadata: Record<string, unknown> } | null;
      if (!recoveryState) throw error;
      if (error instanceof ItsmRoleArchiveUnavailableError) dependencies.reportArchiveUnavailable();
      let auditWasPersisted: boolean;
      try {
        auditWasPersisted = await dependencies.withLock((workspaceStore) => Promise.resolve(
          Boolean(recoveryState.eventId && Array.isArray(workspaceStore.audit)
            && workspaceStore.audit.some((event) => Boolean(
              event && typeof event === "object" && "id" in event && event.id === recoveryState.eventId,
            ))),
        ));
      } catch {
        throw new Error("Le résultat du bootstrap est incertain; comparez le rôle Clerk au journal avant toute nouvelle attribution.");
      }
      if (auditWasPersisted) return dependencies.getUser(userId);
      try {
        await dependencies.updateUserMetadata(userId, {
          publicMetadata: recoveryState.previousMetadata,
        });
      } catch {
        throw new Error("Le rôle N1 n’a pas pu être restauré après l’échec du journal; une réconciliation administrateur est nécessaire.");
      }
      throw error;
    }
  };
}

const bootstrapItsmAdmin = createItsmBootstrapAdmin({
  getUser: (userId) => clerkClient.users.getUser(userId),
  updateUserMetadata: updateUserMetadataAndForget,
  archiveRoleChange: publishItsmRoleChangeToArchive,
  reportArchiveUnavailable: () => reportItsmRoleArchiveUnavailable(
    logger,
    "role_change",
    notifyItsmRoleArchiveAlert,
  ),
  withLock: withAdminChangeLock,
});

type ClerkUser = Awaited<ReturnType<typeof clerkClient.users.getUser>>;
const actorUsers = createActorCache<ClerkUser>();

// Role events of the journal only (not the whole workspace), cached a few seconds.
const roleJournal = createRoleJournalCache(async () => {
  const result = await db.execute(sql`
    select coalesce(jsonb_agg(event), '[]'::jsonb) as events
    from ${itsmWorkspaceTable}, jsonb_array_elements(coalesce(${itsmWorkspaceTable.store}->'audit', '[]'::jsonb)) as event
    where ${itsmWorkspaceTable.id} = ${WORKSPACE_ID} and event->>'type' like 'itsm.role.%'`);
  const rows = (result as unknown as { rows?: Array<{ events?: unknown }> }).rows ?? [];
  return rows[0]?.events ?? [];
});
const reportedJournalGaps = new Set<string>();

/** Clerk metadata write that also drops the cached role of that account. */
async function updateUserMetadataAndForget(userId: string, metadata: Parameters<typeof clerkClient.users.updateUserMetadata>[1]) {
  actorUsers.invalidate(userId);
  try {
    return await clerkClient.users.updateUserMetadata(userId, metadata);
  } finally {
    actorUsers.invalidate(userId);
  }
}

/**
 * Role administration must never act on a cached N1 role: an N1 is re-read
 * from Clerk. Any other cached role is refused by the handler anyway, so it
 * needs no Clerk call (a just-promoted N1 may wait up to the cache TTL).
 */
async function freshActorFor(req: Request, res: Response): Promise<WorkspaceActor | null> {
  const cached = await actorFor(req, res);
  if (!cached || res.headersSent || cached.role !== "N1") return cached;
  return actorFor(req, res, { fresh: true });
}

async function actorFor(req: Request, res: Response, options: { fresh?: boolean } = {}): Promise<WorkspaceActor | null> {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentification requise." });
    return null;
  }
  try {
    let user = options.fresh
      ? await clerkClient.users.getUser(userId)
      : await actorUsers.get(userId, () => clerkClient.users.getUser(userId));
    if (user.publicMetadata.itsmRole == null && isBootstrapAdmin(
      user.primaryEmailAddress?.emailAddress,
      user.primaryEmailAddress?.verification?.status,
      user.publicMetadata.itsmBootstrapCompleted === true,
      process.env.ITSM_BOOTSTRAP_ADMIN_EMAILS,
    )) {
      user = await bootstrapItsmAdmin(userId, process.env.ITSM_BOOTSTRAP_ADMIN_EMAILS);
    }
    const clerkRole = user.publicMetadata.itsmRole;
    const clerkServiceIds = Array.isArray(user.publicMetadata.itsmServiceIds)
      ? user.publicMetadata.itsmServiceIds.filter((id): id is string => typeof id === "string")
      : [];
    // The journal decides (lib/itsm-role-journal.ts): Clerk metadata can be edited
    // outside the application, so a Clerk-only role grants nothing.
    let latest = await roleJournal.latest(userId);
    if (!latest && clerkRole === "N1" && isBootstrapAdmin(
      user.primaryEmailAddress?.emailAddress,
      user.primaryEmailAddress?.verification?.status,
      false,
      process.env.ITSM_BOOTSTRAP_ADMIN_EMAILS,
    )) {
      // Configured bootstrap administrator from before the journal was enforced:
      // record its current N1 role once, so the pilot cannot lock out every N1.
      await withAdminChangeLock(async (store, saveStore) => {
        await saveStore(recordItsmRoleAttestation(store, {
          actorId: "system:bootstrap-attestation",
          targetUserId: userId,
          role: "N1",
          serviceIds: [],
          scope: "Administrateur d’amorçage configuré, attesté à la première connexion après contrôle par le journal",
        }));
      });
      roleJournal.invalidate();
      latest = await roleJournal.latest(userId);
      logger.warn({ alert: "itsm_role_bootstrap_attested", userId }, "ITSM_ROLE_BOOTSTRAP_ATTESTED");
    }
    const decision = decideJournaledRole({ role: clerkRole, serviceIds: clerkServiceIds }, latest);
    if (decision.kind === "unjournaled" && isItsmRole(clerkRole)) {
      res.status(403).json({ error: "Ce rôle n’est pas inscrit au journal des habilitations. Un compte N1 doit le vérifier et l’attester (Préférences, Contrôle des habilitations) avant tout accès." });
      return null;
    }
    if (decision.kind !== "granted" || !isItsmRole(decision.role)) {
      res.status(403).json({ error: "Aucun rôle ITSM n’est attribué à ce compte. Contactez l’administrateur du pilote." });
      return null;
    }
    if (decision.clerkDiffers && !reportedJournalGaps.has(userId)) {
      reportedJournalGaps.add(userId);
      logger.warn({
        alert: "itsm_role_journal_mismatch", userId,
        clerkRole: clerkRole ?? null, clerkServiceIds, journalRole: decision.role, journalServiceIds: decision.serviceIds,
      }, "ITSM_ROLE_JOURNAL_MISMATCH: Clerk metadata ignored, journal role applied");
    }
    return { id: userId, role: decision.role, serviceIds: decision.serviceIds };
  } catch (error) {
    req.log.error({ err: error, userId }, "Could not load Clerk ITSM role");
    res.setHeader("Retry-After", "5");
    res.status(503).json({ error: "Impossible de vérifier le rôle du compte auprès de Clerk." });
    return null;
  }
}

function actorOrReply(req: Request, res: Response, actor: WorkspaceActor | null): actor is WorkspaceActor {
  return actor !== null && !res.headersSent;
}

type RoleDirectoryEventsDependencies = {
  resolveActor: typeof actorFor;
  getUser: (userId: string) => Promise<{ publicMetadata: Record<string, unknown> }>;
  subscribe: typeof subscribeToItsmRoleDirectoryEvents;
  heartbeatMs: number;
};

export function createItsmRoleDirectoryEventsRouter(
  overrides: Partial<RoleDirectoryEventsDependencies> = {},
  authMiddleware: RequestHandler = requireAuth,
): IRouter {
  const dependencies: RoleDirectoryEventsDependencies = {
    resolveActor: actorFor,
    getUser: (userId) => clerkClient.users.getUser(userId),
    subscribe: subscribeToItsmRoleDirectoryEvents,
    heartbeatMs: 25_000,
    ...overrides,
  };
  const eventsRouter: IRouter = Router();

  eventsRouter.get("/itsm/users/events", authMiddleware, async (req, res): Promise<void> => {
    const actor = await dependencies.resolveActor(req, res);
    if (!actorOrReply(req, res, actor)) return;
    if (actor.role !== "N1") {
      res.status(403).json({ error: "Le répertoire des comptes est réservé aux N1." });
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.write(": connected\n\n");

    let closed = false;
    let checkingAuthorization = false;
    let pendingAuthorizationCheck = false;
    let pendingEvent: ItsmRoleDirectoryEvent | undefined;
    let heartbeat: ReturnType<typeof setInterval>;
    let unsubscribe = () => {};

    const closeStream = (notifyRevocation: boolean) => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      if (notifyRevocation && !res.writableEnded) {
        res.write("event: access-revoked\ndata: {}\n\n");
      }
      if (!res.writableEnded) res.end();
    };

    const recheckAuthorization = async (event?: ItsmRoleDirectoryEvent): Promise<void> => {
      if (closed) return;
      if (checkingAuthorization) {
        pendingAuthorizationCheck = true;
        if (event) pendingEvent = event;
        return;
      }
      checkingAuthorization = true;
      try {
        const currentUser = await dependencies.getUser(actor.id);
        if (currentUser.publicMetadata.itsmRole !== "N1") {
          closeStream(true);
          return;
        }
        if (event && !res.writableEnded) {
          res.write(`event: directory-refresh\ndata: ${JSON.stringify({
            userId: event.userId,
            role: event.role,
          })}\n\n`);
        }
      } catch (error) {
        req.log.warn({ err: error, actorId: actor.id }, "Could not recheck ITSM directory event access");
        closeStream(true);
        return;
      } finally {
        checkingAuthorization = false;
      }
      if (pendingAuthorizationCheck && !closed) {
        pendingAuthorizationCheck = false;
        const queuedEvent = pendingEvent;
        pendingEvent = undefined;
        void recheckAuthorization(queuedEvent);
      }
    };

    unsubscribe = dependencies.subscribe((event) => {
      void recheckAuthorization(event);
    });
    heartbeat = setInterval(() => {
      if (closed) return;
      res.write(": keep-alive\n\n");
      void recheckAuthorization();
    }, dependencies.heartbeatMs);
    res.on("close", () => closeStream(false));
  });

  return eventsRouter;
}

router.use(createItsmRoleDirectoryEventsRouter());

router.get("/itsm", requireAuth, async (req, res): Promise<void> => {
  const actor = await actorFor(req, res);
  if (!actorOrReply(req, res, actor)) return;
  requirePermission(actor, "viewWorkspace");
  const [row] = await db.select().from(itsmWorkspaceTable)
    .where(eq(itsmWorkspaceTable.id, WORKSPACE_ID));
  const response = GetItsmWorkspaceResponse.parse({
    store: userStoreView(row?.store ?? {}, actor),
    version: row?.version ?? 0,
  });
  res.json(response);
});

/**
 * Watermark details: account id and the address the request came from. The
 * first X-Forwarded-For entry is used behind the hosting proxy; it is an aid to
 * attribution on screen, not an access control.
 */
/**
 * Message in a temporary channel. Members who cannot save the workspace
 * (auditors, N5) post through this command; the server checks membership and
 * the channel's end date, then journals the post.
 */
router.post("/itsm/conversations/:conversationId/messages", requireAuth, async (req, res): Promise<void> => {
  const actor = await actorFor(req, res);
  if (!actorOrReply(req, res, actor)) return;
  const parsed = PostItsmTemporaryMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Message invalide." });
    return;
  }
  const conversationId = String(req.params.conversationId ?? "");
  try {
    const version = await withAdminChangeLock(async (store, saveStore) => {
      await saveStore(postTemporaryChannelMessage(store, conversationId, parsed.data.body, actor));
      return true;
    });
    res.status(201).json(PostItsmTemporaryMessageResponse.parse({ posted: version }));
  } catch (error) {
    if (error instanceof ItsmAuthorizationError) {
      res.status(403).json({ error: error.message });
      return;
    }
    if (error instanceof Error && /clos|vide ou trop long/.test(error.message)) {
      res.status(409).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Could not post a temporary channel message");
    res.status(503).json({ error: "Impossible d’enregistrer le message. Réessayez plus tard." });
  }
});

router.get("/itsm/session", requireAuth, async (req, res): Promise<void> => {
  const actor = await actorFor(req, res);
  if (!actorOrReply(req, res, actor)) return;
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
  const ip = (forwarded || req.socket.remoteAddress || "inconnue").replace(/^::ffff:/, "").slice(0, 64);
  res.setHeader("Cache-Control", "no-store");
  res.json(GetItsmSessionMarkerResponse.parse({ accountId: actor.id, ip, serverTime: new Date().toISOString() }));
});

// Polling endpoint: reads only the version column, so idle tabs do not pull
// the whole workspace (up to ~1 MB) every few seconds.
router.get("/itsm/version", requireAuth, async (req, res): Promise<void> => {
  const actor = await actorFor(req, res);
  if (!actorOrReply(req, res, actor)) return;
  requirePermission(actor, "viewWorkspace");
  const [row] = await db.select({ version: itsmWorkspaceTable.version }).from(itsmWorkspaceTable)
    .where(eq(itsmWorkspaceTable.id, WORKSPACE_ID));
  res.setHeader("Cache-Control", "no-store");
  res.json(GetItsmWorkspaceVersionResponse.parse({ version: row?.version ?? 0 }));
});

const resolvePeople = createPeopleDirectory(async (ids) =>
  (await clerkClient.users.getUserList({ userId: ids, limit: ids.length })).data);

router.get("/itsm/people", requireAuth, async (req, res): Promise<void> => {
  const actor = await actorFor(req, res);
  if (!actorOrReply(req, res, actor)) return;
  requirePermission(actor, "viewWorkspace");
  const ids = parsePeopleIds(req.query.ids);
  if (!ids) {
    res.status(400).json({ error: "Liste d’identifiants invalide (100 comptes au maximum)." });
    return;
  }
  try {
    res.setHeader("Cache-Control", "private, max-age=300");
    res.json(GetItsmPeopleResponse.parse({ people: await resolvePeople(ids) }));
  } catch (error) {
    req.log.error({ err: error }, "Could not resolve ITSM people names");
    res.status(503).json({ error: "Impossible de charger les noms des comptes." });
  }
});

// Pilot-sized account list (Clerk returns at most 500 per page), cached for a
// minute so typing a name does not call Clerk on every keystroke.
let contactUsersCache: { users: Parameters<typeof contactsFromClerkUsers>[0]; expiresAt: number } | null = null;
const loadContactUsers = async () => {
  if (contactUsersCache && contactUsersCache.expiresAt > Date.now()) return contactUsersCache.users;
  const users = (await clerkClient.users.getUserList({ limit: 500 })).data;
  contactUsersCache = { users, expiresAt: Date.now() + 60_000 };
  return users;
};

router.get("/itsm/roles/reconciliation", requireAuth, createRoleReconciliationHandler({
  resolveActor: freshActorFor,
  scan: scanItsmRoleReconciliation,
  serialize: (body) => GetItsmRoleReconciliationResponse.parse(body),
}));

router.get("/itsm/contacts", requireAuth, async (req, res): Promise<void> => {
  const actor = await actorFor(req, res);
  if (!actorOrReply(req, res, actor)) return;
  if (!["N1", "N2", "N3"].includes(actor.role)) {
    res.status(403).json({ error: "Les canaux bilatéraux sont réservés aux comptes N1 à N3." });
    return;
  }
  const q = req.query.q ?? "";
  if (typeof q !== "string" || q.length > CONTACT_SEARCH_MAX_LENGTH) {
    res.status(400).json({ error: "Recherche invalide." });
    return;
  }
  try {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(GetItsmContactsResponse.parse({ contacts: contactsFromClerkUsers(await loadContactUsers(), actor.id, q) }));
  } catch (error) {
    req.log.error({ err: error }, "Could not load ITSM contacts");
    res.status(503).json({ error: "Impossible de charger la liste des collègues." });
  }
});

type ItsmUserDirectoryDependencies = {
  resolveActor: typeof actorFor;
  getUserList: (options: {
    limit: number;
    offset: number;
    query?: string;
  }) => Promise<unknown>;
  getAvailableServiceIds: () => Promise<ReadonlySet<string>>;
};

export function createItsmUserDirectoryRouter(
  overrides: Partial<ItsmUserDirectoryDependencies> = {},
  authMiddleware: RequestHandler = requireAuth,
): IRouter {
  const dependencies: ItsmUserDirectoryDependencies = {
    resolveActor: actorFor,
    getUserList: (options) => clerkClient.users.getUserList(options),
    getAvailableServiceIds: async () => {
      const [workspaceRow] = await db.select({ store: itsmWorkspaceTable.store }).from(itsmWorkspaceTable)
        .where(eq(itsmWorkspaceTable.id, WORKSPACE_ID));
      const pilotServices = Array.isArray(workspaceRow?.store?.services) ? workspaceRow.store.services : [];
      return new Set(pilotServices.flatMap((service) => {
        if (!service || typeof service !== "object" || Array.isArray(service)) return [];
        const id = (service as Record<string, unknown>).id;
        return typeof id === "string" && id.length > 0 ? [id] : [];
      }));
    },
    ...overrides,
  };
  const directoryRouter: IRouter = Router();

  directoryRouter.get("/itsm/users", authMiddleware, async (req, res): Promise<void> => {
    const actor = await dependencies.resolveActor(req, res);
    if (!actorOrReply(req, res, actor)) return;
    if (actor.role !== "N1") {
      res.status(403).json({ error: "Le répertoire des comptes est réservé aux N1." });
      return;
    }
    if (req.query.q !== undefined && typeof req.query.q !== "string") {
      res.status(400).json({ error: "Recherche invalide." });
      return;
    }
    const parsed = GetItsmUserDirectoryQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { q, limit, offset } = parsed.data;
    try {
      const [page, availableServiceIds] = await Promise.all([
        dependencies.getUserList({
          limit,
          offset,
          ...(q?.trim() ? { query: q.trim() } : {}),
        }),
        dependencies.getAvailableServiceIds(),
      ]);
      if (!page || typeof page !== "object") throw new Error("Invalid ITSM directory provider response.");
      const providerPage = page as { data?: unknown; totalCount?: unknown };
      if (!Array.isArray(providerPage.data)) throw new Error("Invalid ITSM directory provider page.");
      res.json(GetItsmUserDirectoryResponse.parse({
        accounts: providerPage.data.map((user) =>
          toItsmDirectoryAccount(user as Parameters<typeof toItsmDirectoryAccount>[0], availableServiceIds)),
        totalCount: providerPage.totalCount,
        limit,
        offset,
      }));
    } catch (error) {
      req.log.error({ err: error }, "Could not load ITSM user directory");
      res.status(503).json({ error: "Impossible de charger le répertoire des comptes du pilote." });
    }
  });

  return directoryRouter;
}

router.use(createItsmUserDirectoryRouter());

router.post("/itsm", requireAuth, async (req, res): Promise<void> => {
  const parsed = ImportItsmExamplesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = await actorFor(req, res);
  if (!actorOrReply(req, res, actor)) return;
  try {
    requirePermission(actor, "importExamples");
  } catch (error) {
    if (error instanceof ItsmAuthorizationError) {
      res.status(403).json({ error: error.message });
      return;
    }
    throw error;
  }
  const source = parsed.data.store;
  try {
    const snapshot = await db.transaction(async (tx) => {
      await tx.insert(itsmWorkspaceTable).values({
        id: WORKSPACE_ID, version: 0, store: {}, importedUsers: [],
      }).onConflictDoNothing();
      const [row] = await tx.select().from(itsmWorkspaceTable)
        .where(eq(itsmWorkspaceTable.id, WORKSPACE_ID)).for("update");
      if (!row) throw new Error("Espace ITSM indisponible.");
      if (row.importedUsers.includes(actor.id)) return row;
      const merged = mergeLocalExamples(row.store, source, actor);
      const [updated] = await tx.update(itsmWorkspaceTable).set({
        store: merged,
        importedUsers: [...row.importedUsers, actor.id],
        version: row.version + 1,
        updatedAt: new Date(),
      }).where(eq(itsmWorkspaceTable.id, WORKSPACE_ID)).returning();
      return updated!;
    });
    res.json(ImportItsmExamplesResponse.parse({
      store: userStoreView(snapshot.store, actor), version: snapshot.version,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to import ITSM examples");
    res.status(400).json({ error: error instanceof Error ? error.message : "Import impossible." });
  }
});

type WorkspaceSaveDependencies = {
  resolveActor: typeof actorFor;
  workspaceId: string;
  saveWorkspace: (input: {
    workspaceId: string;
    submitted: Record<string, unknown>;
    expectedVersion: number;
    actor: WorkspaceActor;
  }) => Promise<VersionedWorkspaceSave>;
};

export function createItsmWorkspaceSaveRouter(
  overrides: Partial<WorkspaceSaveDependencies> = {},
  authMiddleware: RequestHandler = requireAuth,
): IRouter {
  const saveRouter: IRouter = Router();
  const dependencies: WorkspaceSaveDependencies = {
    resolveActor: actorFor,
    workspaceId: WORKSPACE_ID,
    saveWorkspace: async ({ workspaceId, submitted, expectedVersion, actor }) =>
      db.transaction(async (tx) => {
        await tx.insert(itsmWorkspaceTable).values({
          id: workspaceId, version: 0, store: {}, importedUsers: [],
        }).onConflictDoNothing();
        const [row] = await tx.select().from(itsmWorkspaceTable)
          .where(eq(itsmWorkspaceTable.id, workspaceId)).for("update");
        if (!row) throw new Error("Espace ITSM indisponible.");
        const saved = saveWorkspaceAtVersion(
          row.store,
          row.version,
          submitted,
          expectedVersion,
          actor,
        );
        if (!saved.conflict) {
          await tx.update(itsmWorkspaceTable).set({
            store: saved.store,
            version: saved.version,
            updatedAt: new Date(),
          }).where(eq(itsmWorkspaceTable.id, workspaceId));
        }
        return saved;
      }),
    ...overrides,
  };

  saveRouter.put("/itsm", authMiddleware, async (req, res): Promise<void> => {
    const parsed = SaveItsmWorkspaceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const actor = await dependencies.resolveActor(req, res);
    if (!actorOrReply(req, res, actor)) return;
    if (actor.role === "N5") {
      res.status(403).json({ error: "Le rôle N5 est en consultation seule." });
      return;
    }
    requirePermission(actor, "saveWorkspace");
    try {
      const outcome = await dependencies.saveWorkspace({
        workspaceId: dependencies.workspaceId,
        submitted: parsed.data.store,
        expectedVersion: parsed.data.version,
        actor,
      });
      if (outcome.conflict) {
        const conflict = workspaceVersionConflictResponse(outcome.store, outcome.version, actor);
        res.status(409).json({
          ...conflict,
          current: GetItsmWorkspaceResponse.parse(conflict.current),
        });
        return;
      }
      res.json(SaveItsmWorkspaceResponse.parse({
        store: userStoreView(outcome.store, actor), version: outcome.version,
      }));
    } catch (error) {
      if (error instanceof ItsmAuthorizationError) {
        res.status(403).json({ error: error.message });
        return;
      }
      req.log.warn({ err: error }, "Rejected ITSM workspace update");
      res.status(400).json({ error: error instanceof Error ? error.message : "Modification refusée." });
    }
  });

  return saveRouter;
}

const loadStoredAuditEvents = async () => {
  const [row] = await db.select().from(itsmWorkspaceTable)
    .where(eq(itsmWorkspaceTable.id, WORKSPACE_ID));
  return Array.isArray(row?.store?.audit) ? row.store.audit : [];
};

// 30 calls a minute per account across the journal routes (see lib/itsm-rate-limit.ts).
const auditRateLimit = createAuditRateLimit({ accountOf: (req) => getAuth(req).userId });

router.get("/itsm/audit/integrity", requireAuth, auditRateLimit, createItsmAuditIntegrityHandler({
  resolveActor: actorFor,
  loadAuditEvents: loadStoredAuditEvents,
}));

router.get("/itsm/audit/proof", requireAuth, auditRateLimit, createItsmAuditProofHandler({
  resolveActor: actorFor,
  loadAuditEvents: loadStoredAuditEvents,
}));

router.get("/itsm/audit/siem", requireAuth, auditRateLimit, createItsmAuditSiemHandler({
  resolveActor: actorFor,
  loadAuditEvents: loadStoredAuditEvents,
}));

router.get("/itsm/audit/export", requireAuth, auditRateLimit, createItsmAuditExportHandler({
  resolveActor: actorFor,
  loadAuditEvents: loadStoredAuditEvents,
  resolveNames: async (ids) => {
    const people = [];
    for (let i = 0; i < ids.length; i += MAX_PEOPLE_PER_REQUEST) {
      people.push(...await resolvePeople(ids.slice(i, i + MAX_PEOPLE_PER_REQUEST)));
    }
    return new Map(people.map((person) => [person.userId, person.name]));
  },
}));

type RoleAssignmentDependencies = {
  resolveActor: typeof actorFor;
  getUser: (userId: string) => Promise<{
    id: string;
    publicMetadata: Record<string, unknown>;
  }>;
  activeN1Ids: () => Promise<string[]>;
  updateUserMetadata: (
    userId: string,
    metadata: { publicMetadata: Record<string, unknown> },
  ) => Promise<unknown>;
  archiveRoleChange: (event: ItsmRoleChangeArchiveEvent) => Promise<void>;
  reportArchiveUnavailable: () => void;
  withLock: typeof withAdminChangeLock;
};

function createRoleAssignmentHandler(dependencies: RoleAssignmentDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
  const actor = await dependencies.resolveActor(req, res);
  if (!actorOrReply(req, res, actor)) return;
  const parsedParams = AssignItsmRoleParams.safeParse(req.params);
  const parsedBody = AssignItsmRoleBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Modification d’habilitation invalide. Un N1 peut nommer un remplaçant N1, attribuer N2 à N5 ou retirer un accès." });
    return;
  }
  const { userId: targetUserId } = parsedParams.data;
  const { role, serviceIds } = parsedBody.data;
  let restorationFailed = false;
  const roleChangeRecovery: {
    value: {
      eventId: string;
      result: ReturnType<typeof AssignItsmRoleResponse.parse>;
    } | null;
  } = { value: null };
  const metadataRestore = {
    value: null as { userId: string; publicMetadata: Record<string, unknown> } | null,
  };
  try {
    const outcome = await dependencies.withLock(async (workspaceStore, saveStore) => {
      // Re-read the actor inside the same lock: a concurrently demoted N1 must not
      // carry a stale request through the role-change gate.
      const currentActor = await dependencies.getUser(actor.id);
      if (currentActor.publicMetadata.itsmRole !== "N1") {
        return { status: 403, error: "Votre rôle N1 a changé; reconnectez-vous avant de gérer les habilitations." } as const;
      }
      let target;
      try {
        target = await dependencies.getUser(targetUserId);
      } catch {
        return { status: 404, error: "Compte Clerk introuvable." } as const;
      }
      const activeAdmins = await dependencies.activeN1Ids();
      // activeAdmins comes from the journal: a target that is N1 there stays protected
      // as the last N1 even if its Clerk metadata was edited down.
      const targetGuardRole = activeAdmins.includes(targetUserId) ? "N1" : target.publicMetadata.itsmRole;
      if (!canChangeItsmRole(actor, targetUserId, targetGuardRole, role, activeAdmins)) {
        const lastAdmin = targetGuardRole === "N1"
          && role !== "N1"
          && !activeAdmins.some((id) => id !== targetUserId);
        return {
          status: 403,
          error: lastAdmin
            ? "Impossible de retirer le dernier accès N1 actif. Nommez et vérifiez d’abord un remplaçant N1."
            : "Cette modification est réservée à un compte N1; un rôle inférieur ne peut pas obtenir N1.",
        } as const;
      }
      const uniqueServiceIds = role === null ? [] : [...new Set(serviceIds)];
      const knownServiceIds = new Set(
        Array.isArray(workspaceStore.services)
          ? workspaceStore.services
            .filter((service): service is Record<string, unknown> => Boolean(service && typeof service === "object" && !Array.isArray(service)))
            .map((service) => String(service.id ?? ""))
          : [],
      );
      if (uniqueServiceIds.some((serviceId) => !knownServiceIds.has(serviceId))) {
        return { status: 400, error: "Un ou plusieurs services autorisés sont introuvables dans le pilote." } as const;
      }
      const previousRole = typeof target.publicMetadata.itsmRole === "string"
        ? target.publicMetadata.itsmRole
        : null;
      const previousServiceIds = Array.isArray(target.publicMetadata.itsmServiceIds)
        ? target.publicMetadata.itsmServiceIds.filter((id): id is string => typeof id === "string")
        : [];
      const result = AssignItsmRoleResponse.parse({
        userId: targetUserId,
        role,
        label: role ? itsmRoleName(role as ItsmRole) : "Aucun accès",
        serviceIds: uniqueServiceIds,
      });
      const normalizeServiceIds = (ids: string[]) => [...new Set(ids)].sort();
      const latestRoleChange = Array.isArray(workspaceStore.audit)
        ? workspaceStore.audit.find((event) =>
          Boolean(
            event
            && typeof event === "object"
            && "type" in event
            && event.type === "itsm.role.changed"
            && "targetUserId" in event
            && event.targetUserId === targetUserId,
          ))
        : undefined;
      const alreadyRecorded = Boolean(
        target.publicMetadata.itsmRole === role
        && JSON.stringify(normalizeServiceIds(previousServiceIds)) === JSON.stringify(normalizeServiceIds(uniqueServiceIds))
        && latestRoleChange
        && typeof latestRoleChange === "object"
        && "actor" in latestRoleChange
        && latestRoleChange.actor === actor.id
        && "nextRole" in latestRoleChange
        && latestRoleChange.nextRole === role
        && "serviceIds" in latestRoleChange
        && Array.isArray(latestRoleChange.serviceIds)
        && JSON.stringify(normalizeServiceIds(latestRoleChange.serviceIds.filter((id: unknown): id is string => typeof id === "string")))
          === JSON.stringify(normalizeServiceIds(uniqueServiceIds)),
      );
      if (alreadyRecorded) {
        return { status: 200, result } as const;
      }
      const services = Array.isArray(workspaceStore.services)
        ? workspaceStore.services.filter((service): service is Record<string, unknown> =>
          Boolean(service && typeof service === "object" && !Array.isArray(service)))
        : [];
      const describeScope = (ids: string[], assignedRole: string | null) => {
        if (assignedRole === null) return "Aucun accès";
        if (ids.length === 0) return assignedRole === "N4" ? "Aucun service" : "Tous les services";
        return ids.map((id) => {
          const service = services.find((candidate) => String(candidate.id ?? "") === id);
          return String(service?.name ?? service?.title ?? id);
        }).join(", ");
      };
      metadataRestore.value = {
        userId: targetUserId,
        publicMetadata: target.publicMetadata as Record<string, unknown>,
      };
      await dependencies.updateUserMetadata(targetUserId, {
        // Deliberate admin changes must never be silently undone by first-admin bootstrap.
        publicMetadata: metadataForItsmRoleChange(target.publicMetadata, role, uniqueServiceIds),
      });
      const nextStore = recordItsmRoleChange(workspaceStore, {
        actorId: actor.id,
        targetUserId,
        previousRole,
        nextRole: role,
        previousServiceIds,
        serviceIds: uniqueServiceIds,
        scope: `${describeScope(previousServiceIds, previousRole)} → ${describeScope(uniqueServiceIds, role)}`,
      });
      const roleChangeEvent = (nextStore.audit as ItsmRoleChangeArchiveEvent[])[0];
      try {
        await dependencies.archiveRoleChange(roleChangeEvent);
      } catch {
        throw new ItsmRoleArchiveUnavailableError();
      }
      roleChangeRecovery.value = { eventId: roleChangeEvent.id, result };
      await saveStore(nextStore);
      return {
        status: 200,
        result,
      } as const;
    });
    if (outcome.status !== 200) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    publishItsmRoleDirectoryEvent({
      userId: outcome.result.userId,
      role: outcome.result.role,
    });
    res.json(outcome.result);
  } catch (error) {
    const archiveUnavailable = error instanceof ItsmRoleArchiveUnavailableError;
    if (archiveUnavailable) dependencies.reportArchiveUnavailable();

    const pendingRoleChange = roleChangeRecovery.value;
    if (pendingRoleChange) {
      try {
        const auditWasPersisted = await dependencies.withLock((workspaceStore) => Promise.resolve(
          Array.isArray(workspaceStore.audit)
            && workspaceStore.audit.some((event) =>
              Boolean(event && typeof event === "object" && "id" in event && event.id === pendingRoleChange.eventId)),
        ));
        if (auditWasPersisted) {
          publishItsmRoleDirectoryEvent({
            userId: pendingRoleChange.result.userId,
            role: pendingRoleChange.result.role,
          });
          res.json(pendingRoleChange.result);
          return;
        }
      } catch (verificationError) {
        req.log.error({
          err: verificationError,
          alert: "itsm_role_reconciliation_required",
          actorId: actor.id,
          targetUserId,
          expectedPreviousRole: metadataRestore.value?.publicMetadata.itsmRole ?? null,
          requestedRole: role,
          requestedServiceIds: role === null ? [] : [...new Set(serviceIds)],
          procedure: "Pause further role changes for this account; compare Clerk public metadata with the ITSM audit and restore or document the verified state.",
        }, "ITSM_ROLE_RECONCILIATION_REQUIRED: audit persistence could not be verified");
        res.status(503).json({
          error: "L’enregistrement du journal est incertain. Le rôle n’a pas été restauré automatiquement; suspendez les changements sur ce compte et demandez une réconciliation à l’administrateur.",
        });
        return;
      }
    }

    if (metadataRestore.value) {
      try {
        await dependencies.updateUserMetadata(metadataRestore.value.userId, {
          publicMetadata: metadataRestore.value.publicMetadata,
        });
      } catch (rollbackError) {
        restorationFailed = true;
        req.log.error({
          err: rollbackError,
          alert: "itsm_role_reconciliation_required",
          actorId: actor.id,
          targetUserId,
          expectedPreviousRole: metadataRestore.value.publicMetadata.itsmRole ?? null,
          expectedPreviousServiceIds: metadataRestore.value.publicMetadata.itsmServiceIds ?? [],
          requestedRole: role,
          requestedServiceIds: role === null ? [] : [...new Set(serviceIds)],
          procedure: "Pause further role changes for this account; compare Clerk public metadata with the ITSM audit and restore or document the verified state.",
        }, "ITSM_ROLE_RECONCILIATION_REQUIRED: Clerk role restoration failed after audit persistence failure");
      }
    }
    if (restorationFailed) {
      res.status(503).json({
        error: "La restauration du rôle a échoué. L’état Clerk et le journal peuvent être incohérents; suspendez les changements sur ce compte et demandez une réconciliation à l’administrateur.",
      });
      return;
    }
    if (archiveUnavailable) {
      res.status(503).json({
        error: "L’archive des habilitations est indisponible. Aucun changement de rôle n’a été conservé; réessayez ou contactez l’administrateur.",
      });
      return;
    }
    req.log.warn({ targetUserId }, "Could not update Clerk ITSM role");
    res.status(503).json({ error: "Impossible de vérifier ou d’enregistrer cette relève auprès du pilote." });
  }
  };
}

export function createItsmRoleAssignmentRouter(
  overrides: Partial<RoleAssignmentDependencies> = {},
  authMiddleware: RequestHandler = requireAuth,
): IRouter {
  const roleRouter: IRouter = Router();
  roleRouter.put("/itsm/users/:userId/role", authMiddleware, createRoleAssignmentHandler({
    resolveActor: freshActorFor,
    getUser: (userId) => clerkClient.users.getUser(userId),
    activeN1Ids,
    updateUserMetadata: updateUserMetadataAndForget,
    archiveRoleChange: publishItsmRoleChangeToArchive,
    reportArchiveUnavailable: () => reportItsmRoleArchiveUnavailable(
      logger,
      "role_change",
      notifyItsmRoleArchiveAlert,
    ),
    withLock: withAdminChangeLock,
    ...overrides,
  }));
  return roleRouter;
}

type RoleAttestationDependencies = {
  resolveActor: typeof actorFor;
  getUser: (userId: string) => Promise<{ id: string; publicMetadata: Record<string, unknown> }>;
  archiveRoleChange: (event: ItsmRoleChangeArchiveEvent) => Promise<void>;
  reportArchiveUnavailable: () => void;
  withLock: typeof withAdminChangeLock;
};

function createRoleAttestationHandler(dependencies: RoleAttestationDependencies) {
  return async (req: Request, res: Response): Promise<void> => {
    const actor = await dependencies.resolveActor(req, res);
    if (!actorOrReply(req, res, actor)) return;
    if (actor.role !== "N1") {
      res.status(403).json({ error: "L’attestation des habilitations est réservée aux N1." });
      return;
    }
    const parsedParams = AttestItsmRoleParams.safeParse(req.params);
    const parsedBody = AttestItsmRoleBody.safeParse(req.body);
    if (!parsedParams.success || !parsedBody.success) {
      res.status(400).json({ error: "Compte cible ou habilitation à attester invalide." });
      return;
    }
    const { userId: targetUserId } = parsedParams.data;
    try {
      const outcome = await dependencies.withLock(async (workspaceStore, saveStore) => {
        const currentActor = await dependencies.getUser(actor.id);
        if (currentActor.publicMetadata.itsmRole !== "N1") {
          return { status: 403, error: "Votre rôle N1 a changé; reconnectez-vous avant d’attester une habilitation." } as const;
        }
        let target;
        try {
          target = await dependencies.getUser(targetUserId);
        } catch {
          return { status: 404, error: "Compte Clerk introuvable." } as const;
        }
        const role = target.publicMetadata.itsmRole;
        if (!isItsmRole(role)) {
          return { status: 409, error: "Ce compte n’a actuellement aucun rôle ITSM valide à attester." } as const;
        }
        const serviceIds = [...new Set(
          Array.isArray(target.publicMetadata.itsmServiceIds)
            ? target.publicMetadata.itsmServiceIds.filter((id): id is string => typeof id === "string")
            : [],
        )].sort();
        const reviewedServiceIds = [...new Set(parsedBody.data.serviceIds)].sort();
        if (role !== parsedBody.data.role || JSON.stringify(serviceIds) !== JSON.stringify(reviewedServiceIds)) {
          return {
            status: 409,
            error: "Le rôle ou les services ont changé depuis leur consultation. Actualisez le répertoire et vérifiez de nouveau l’habilitation avant de l’attester.",
          } as const;
        }
        const scope = serviceIds.length
          ? `${role} · services ${serviceIds.join(", ")}`
          : role === "N4" ? "N4 · aucun service attribué" : `${role} · tous les services`;
        const nextStore = recordItsmRoleAttestation(workspaceStore, {
          actorId: actor.id,
          targetUserId,
          role,
          serviceIds,
          scope,
        });
        const event = (nextStore.audit as ItsmRoleChangeArchiveEvent[])[0];
        try {
          await dependencies.archiveRoleChange(event);
        } catch {
          throw new ItsmRoleArchiveUnavailableError();
        }
        await saveStore(nextStore);
        return {
          status: 200,
          result: { userId: targetUserId, role, serviceIds, attestedAt: event.at },
        } as const;
      });
      if (outcome.status !== 200) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      res.json(AttestItsmRoleResponse.parse(outcome.result));
    } catch (error) {
      const archiveUnavailable = error instanceof ItsmRoleArchiveUnavailableError;
      if (archiveUnavailable) dependencies.reportArchiveUnavailable();
      req.log.error({ err: error, actorId: actor.id, targetUserId }, "Could not attest ITSM role");
      res.status(503).json({
        error: archiveUnavailable
          ? "L’archive des habilitations est indisponible. L’attestation n’a pas été enregistrée."
          : "Impossible d’enregistrer l’attestation du rôle dans le journal.",
      });
    }
  };
}

export function createItsmRoleAttestationRouter(
  overrides: Partial<RoleAttestationDependencies> = {},
  authMiddleware: RequestHandler = requireAuth,
): IRouter {
  const attestationRouter: IRouter = Router();
  attestationRouter.post("/itsm/users/:userId/role/attest", authMiddleware, createRoleAttestationHandler({
    resolveActor: freshActorFor,
    getUser: (userId) => clerkClient.users.getUser(userId),
    archiveRoleChange: publishItsmRoleChangeToArchive,
    reportArchiveUnavailable: () => reportItsmRoleArchiveUnavailable(
      logger,
      "role_attestation",
      notifyItsmRoleArchiveAlert,
    ),
    withLock: withAdminChangeLock,
    ...overrides,
  }));
  return attestationRouter;
}

router.use(createItsmRoleArchiveCheckRouter());
router.use(createItsmWorkspaceSaveRouter());
router.use(createItsmRoleAssignmentRouter());
router.use(createItsmRoleAttestationRouter());

export default router;
