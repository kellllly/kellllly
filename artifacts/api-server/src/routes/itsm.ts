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
  GetItsmUserDirectoryQueryParams,
  GetItsmUserDirectoryResponse,
  ImportItsmExamplesBody,
  ImportItsmExamplesResponse,
  SaveItsmWorkspaceBody,
  SaveItsmWorkspaceResponse,
} from "@workspace/api-zod";
import { db, itsmWorkspaceTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type RequestHandler, type Response } from "express";
import { logger } from "../lib/logger";
import { reportItsmRoleArchiveUnavailable } from "../lib/itsm-role-archive-monitor";
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
  type ItsmRoleSnapshot,
  type ItsmRoleChangeArchiveEvent,
} from "../lib/itsm-workspace";
import { toItsmDirectoryAccount } from "../lib/itsm-user-directory";
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
import { createItsmAuditExportHandler } from "./itsm-audit-export";

import { developmentRoleArchiveEnabled } from "../lib/development-role-archive-config";

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
    };
    return operation(row.store, saveStore);
  });
}

export async function scanItsmRoleReconciliation() {
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
      if (user.publicMetadata.itsmRole === "N1") ids.add(user.id);
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
      }));
    } catch (error) {
      const message = error instanceof ItsmRoleArchiveUnavailableError
        ? error.message
        : "Impossible de vérifier la connexion à l’archive.";
      req.log.warn({ err: error, actorId: actor.id }, "External role archive connection check failed");
      res.status(503).json({ error: message });
    }
  };
}

export function createItsmRoleArchiveCheckRouter(
  overrides: Partial<RoleArchiveCheckDependencies> = {},
  authMiddleware: RequestHandler = requireAuth,
): IRouter {
  const archiveCheckRouter: IRouter = Router();
  archiveCheckRouter.post("/itsm/role-archive/check", authMiddleware, createRoleArchiveCheckHandler({
    resolveActor: actorFor,
    checkArchiveConnection: checkItsmRoleArchiveAvailability,
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
  updateUserMetadata: (userId, metadata) => clerkClient.users.updateUserMetadata(userId, metadata),
  archiveRoleChange: publishItsmRoleChangeToArchive,
  reportArchiveUnavailable: () => reportItsmRoleArchiveUnavailable(logger, "role_change"),
  withLock: withAdminChangeLock,
});

async function actorFor(req: Request, res: Response): Promise<WorkspaceActor | null> {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentification requise." });
    return null;
  }
  try {
    let user = await clerkClient.users.getUser(userId);
    if (user.publicMetadata.itsmRole == null && isBootstrapAdmin(
      user.primaryEmailAddress?.emailAddress,
      user.primaryEmailAddress?.verification?.status,
      user.publicMetadata.itsmBootstrapCompleted === true,
      process.env.ITSM_BOOTSTRAP_ADMIN_EMAILS,
    )) {
      user = await bootstrapItsmAdmin(userId, process.env.ITSM_BOOTSTRAP_ADMIN_EMAILS);
    }
    const role = user.publicMetadata.itsmRole;
    if (!isItsmRole(role)) {
      res.status(403).json({ error: "Aucun rôle ITSM n’est attribué à ce compte. Contactez l’administrateur du pilote." });
      return null;
    }
    const serviceIds = Array.isArray(user.publicMetadata.itsmServiceIds)
      ? user.publicMetadata.itsmServiceIds.filter((id): id is string => typeof id === "string")
      : [];
    return { id: userId, role, serviceIds };
  } catch (error) {
    req.log.error({ err: error, userId }, "Could not load Clerk ITSM role");
    res.status(503).json({ error: "Impossible de vérifier le rôle du compte auprès de Clerk." });
    return null;
  }
}

function actorOrReply(req: Request, res: Response, actor: WorkspaceActor | null): actor is WorkspaceActor {
  return actor !== null && !res.headersSent;
}

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

router.get("/itsm/users", requireAuth, async (req, res): Promise<void> => {
  const actor = await actorFor(req, res);
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
    const page = await clerkClient.users.getUserList({
      limit,
      offset,
      ...(q?.trim() ? { query: q.trim() } : {}),
    });
    res.json(GetItsmUserDirectoryResponse.parse({
      accounts: page.data.map(toItsmDirectoryAccount),
      totalCount: page.totalCount,
      limit,
      offset,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Could not load ITSM user directory");
    res.status(503).json({ error: "Impossible de charger le répertoire des comptes du pilote." });
  }
});

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

router.put("/itsm", requireAuth, async (req, res): Promise<void> => {
  const parsed = SaveItsmWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const actor = await actorFor(req, res);
  if (!actorOrReply(req, res, actor)) return;
  if (actor.role === "N5") {
    res.status(403).json({ error: "Le rôle N5 est en consultation seule." });
    return;
  }
  requirePermission(actor, "saveWorkspace");
  try {
    const outcome = await db.transaction(async (tx) => {
      await tx.insert(itsmWorkspaceTable).values({
        id: WORKSPACE_ID, version: 0, store: {}, importedUsers: [],
      }).onConflictDoNothing();
      const [row] = await tx.select().from(itsmWorkspaceTable)
        .where(eq(itsmWorkspaceTable.id, WORKSPACE_ID)).for("update");
      if (!row) throw new Error("Espace ITSM indisponible.");
      const saved = saveWorkspaceAtVersion(
        row.store,
        row.version,
        parsed.data.store,
        parsed.data.version,
        actor,
      );
      if (saved.conflict) return { conflict: true as const, row, store: saved.store, version: saved.version };
      const [updated] = await tx.update(itsmWorkspaceTable).set({
        store: saved.store,
        version: saved.version,
        updatedAt: new Date(),
      }).where(eq(itsmWorkspaceTable.id, WORKSPACE_ID)).returning();
      return { conflict: false as const, row: updated! };
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
      store: userStoreView(outcome.row.store, actor), version: outcome.row.version,
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

router.get("/itsm/audit/export", requireAuth, createItsmAuditExportHandler({
  resolveActor: actorFor,
  loadAuditEvents: async () => {
    const [row] = await db.select().from(itsmWorkspaceTable)
      .where(eq(itsmWorkspaceTable.id, WORKSPACE_ID));
    return Array.isArray(row?.store?.audit) ? row.store.audit : [];
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
      if (!canChangeItsmRole(actor, targetUserId, target.publicMetadata.itsmRole, role, activeAdmins)) {
        const lastAdmin = target.publicMetadata.itsmRole === "N1"
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
      const result = AssignItsmRoleResponse.parse({
        userId: targetUserId,
        role,
        label: role ? itsmRoleName(role as ItsmRole) : "Aucun accès",
        serviceIds: uniqueServiceIds,
      });
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
    resolveActor: actorFor,
    getUser: (userId) => clerkClient.users.getUser(userId),
    activeN1Ids,
    updateUserMetadata: (userId, metadata) => clerkClient.users.updateUserMetadata(userId, metadata),
    archiveRoleChange: publishItsmRoleChangeToArchive,
    reportArchiveUnavailable: () => reportItsmRoleArchiveUnavailable(logger, "role_change"),
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
    resolveActor: actorFor,
    getUser: (userId) => clerkClient.users.getUser(userId),
    archiveRoleChange: publishItsmRoleChangeToArchive,
    reportArchiveUnavailable: () => reportItsmRoleArchiveUnavailable(logger, "role_attestation"),
    withLock: withAdminChangeLock,
    ...overrides,
  }));
  return attestationRouter;
}

router.use(createItsmRoleArchiveCheckRouter());
router.use(createItsmRoleAssignmentRouter());
router.use(createItsmRoleAttestationRouter());

export default router;
