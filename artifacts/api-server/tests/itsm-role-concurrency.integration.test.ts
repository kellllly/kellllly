import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { build } from "esbuild";

test("role PUT serializes concurrent N1 changes and rejects missing services, stale actors, or failed writes", {
  skip: !process.env.DATABASE_URL && "Requires the PostgreSQL integration database",
}, async () => {
  const workspaceId = `itsm-role-test-${randomUUID()}`;
  const accountPrefix = `itsm-role-test-${randomUUID()}`;
  const assignedServiceId = `${accountPrefix}-service`;
  const assignedServiceName = "Direction du support";
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const tempBuildDir = await mkdtemp(path.join(packageDir, "node_modules", ".itsm-role-test-"));
  let pool: import("pg").Pool | undefined;
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  let blocker: import("pg").PoolClient | undefined;

  try {
    const bundlePath = path.join(tempBuildDir, "itsm-role-route.mjs");
    await mkdir(path.join(tempBuildDir, "node_modules"), { recursive: true });
    await symlink(
      path.resolve(packageDir, "../../lib/db/node_modules/pg"),
      path.join(tempBuildDir, "node_modules/pg"),
    );
    await build({
      entryPoints: [path.join(packageDir, "src/routes/itsm.ts")],
      outfile: bundlePath,
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["express", "express-rate-limit", "pkijs", "asn1js", "pino", "pino-http", "@clerk/express", "pg"],
      sourcemap: false,
      logLevel: "silent",
    });
    const { createItsmRoleAssignmentRouter, withAdminChangeLock } = await import(pathToFileURL(bundlePath).href);
    const requireFromPackage = createRequire(path.join(packageDir, "src/routes/itsm.ts"));
    const pg = requireFromPackage(path.resolve(packageDir, "../../lib/db/node_modules/pg"));
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    await withAdminChangeLock(async (store: Record<string, unknown>, saveStore: (nextStore: Record<string, unknown>) => Promise<void>) => {
      await saveStore({
        ...store,
        services: [{ id: assignedServiceId, name: assignedServiceName }],
      });
    }, workspaceId);

    const users = new Map<string, { id: string; publicMetadata: Record<string, unknown> }>();
    const adminA = `${accountPrefix}-admin-a`;
    const adminB = `${accountPrefix}-admin-b`;
    const nonAdmin = `${accountPrefix}-user`;
    const scopedUser = `${accountPrefix}-scoped-user`;
    users.set(adminA, { id: adminA, publicMetadata: { itsmRole: "N1", itsmServiceIds: [] } });
    users.set(adminB, { id: adminB, publicMetadata: { itsmRole: "N1", itsmServiceIds: [] } });
    users.set(nonAdmin, { id: nonAdmin, publicMetadata: { itsmRole: "N5", itsmServiceIds: [] } });
    users.set(scopedUser, { id: scopedUser, publicMetadata: { itsmRole: "N5", itsmServiceIds: [] } });

    let rejectNextClerkUpdate = false;
    let rejectNextArchiveWrite = false;
    const archivedRoleEvents: Record<string, unknown>[] = [];
    let onActorResolved: (() => void) | undefined;
    const app = express();
    app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
    app.use(express.json());
    app.use(createItsmRoleAssignmentRouter({
      checkStepUp: () => ({ ok: true }),
      resolveActor: async (req, res) => {
        const actorId = req.header("x-test-actor") ?? "";
        const user = users.get(actorId);
        if (!user) {
          res.status(401).json({ error: "Missing test account" });
          return null;
        }
        onActorResolved?.();
        onActorResolved = undefined;
        const role = user.publicMetadata.itsmRole;
        if (role !== "N1" && role !== "N2" && role !== "N3" && role !== "N4" && role !== "N5") {
          res.status(403).json({ error: "No assigned test role" });
          return null;
        }
        return { id: actorId, role, serviceIds: [] };
      },
      getUser: async (userId) => {
        const user = users.get(userId);
        if (!user) throw new Error("Unknown test account");
        return user;
      },
      activeN1Ids: async () => [...users.values()]
        .filter((user) => user.publicMetadata.itsmRole === "N1")
        .map((user) => user.id),
      updateUserMetadata: async (userId, metadata) => {
        if (rejectNextClerkUpdate) {
          rejectNextClerkUpdate = false;
          throw new Error("Simulated Clerk failure");
        }
        const user = users.get(userId);
        if (!user) throw new Error("Unknown test account");
        user.publicMetadata = metadata.publicMetadata;
        return user;
      },
      archiveRoleChange: async (event) => {
        if (rejectNextArchiveWrite) {
          rejectNextArchiveWrite = false;
          throw new Error("Simulated archive outage");
        }
        archivedRoleEvents.push(structuredClone(event));
      },
      withLock: (operation) => withAdminChangeLock(operation, workspaceId),
    }, (_req, _res, next) => next()));

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const endpoint = (targetId: string) =>
      `http://127.0.0.1:${address.port}/itsm/users/${encodeURIComponent(targetId)}/role`;
    const removeAdmin = (actorId: string, targetId: string) => fetch(endpoint(targetId), {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-actor": actorId },
      body: JSON.stringify({ role: "N2", serviceIds: [] }),
    });

    const simultaneous = await Promise.all([
      removeAdmin(adminA, adminB),
      removeAdmin(adminB, adminA),
    ]);
    assert.deepEqual(simultaneous.map((response) => response.status).sort(), [200, 403]);
    assert.equal(archivedRoleEvents.length, 1, "only the successful role change must be archived");
    const archivedEvent = archivedRoleEvents[0];
    assert.ok([adminA, adminB].includes(String(archivedEvent.actor)));
    assert.ok([adminA, adminB].includes(String(archivedEvent.targetUserId)));
    assert.notEqual(archivedEvent.actor, archivedEvent.targetUserId);
    assert.equal(archivedEvent.type, "itsm.role.changed");
    assert.equal(archivedEvent.previousRole, "N1");
    assert.equal(archivedEvent.nextRole, "N2");
    assert.deepEqual(archivedEvent.previousServiceIds, []);
    assert.deepEqual(archivedEvent.serviceIds, []);
    assert.equal(archivedEvent.scope, "Tous les services → Tous les services");
    assert.equal(typeof archivedEvent.at, "string");

    const successfulResponse = simultaneous.find((response) => response.status === 200)!;
    assert.deepEqual(await successfulResponse.json(), {
      userId: archivedEvent.targetUserId,
      role: "N2",
      label: "Analyste",
      serviceIds: [],
    });
    const { rows: rereadRows } = await pool.query(
      'SELECT store FROM "anif_itsm_workspace" WHERE id = $1',
      [workspaceId],
    );
    assert.equal(rereadRows.length, 1, "the role change must persist a workspace");
    const persistedEvent = (rereadRows[0].store.audit as Record<string, unknown>[])
      .find((event) => event.id === archivedEvent.id);
    assert.ok(persistedEvent, "the successful role change must remain in the re-read workspace journal");
    assert.deepEqual({
      actor: persistedEvent.actor,
      targetUserId: persistedEvent.targetUserId,
      previousRole: persistedEvent.previousRole,
      nextRole: persistedEvent.nextRole,
      previousServiceIds: persistedEvent.previousServiceIds,
      serviceIds: persistedEvent.serviceIds,
      scope: persistedEvent.scope,
    }, {
      actor: archivedEvent.actor,
      targetUserId: archivedEvent.targetUserId,
      previousRole: "N1",
      nextRole: "N2",
      previousServiceIds: [],
      serviceIds: [],
      scope: "Tous les services → Tous les services",
    });
    assert.equal(
      [...users.values()].filter((user) => user.publicMetadata.itsmRole === "N1").length,
      1,
      "concurrent demotions must leave exactly one active N1",
    );

    const scopedUserMetadataBefore = structuredClone(users.get(scopedUser)!.publicMetadata);
    assert.equal(scopedUserMetadataBefore.itsmRole, "N5");
    assert.deepEqual(scopedUserMetadataBefore.itsmServiceIds, []);
    const scopedAssignmentActor = [...users.values()].find((user) => user.publicMetadata.itsmRole === "N1")!;
    const scopedAssignmentResponse = await fetch(endpoint(scopedUser), {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-actor": scopedAssignmentActor.id },
      body: JSON.stringify({ role: "N4", serviceIds: [assignedServiceId] }),
    });
    assert.equal(scopedAssignmentResponse.status, 200);
    assert.deepEqual(await scopedAssignmentResponse.json(), {
      userId: scopedUser,
      role: "N4",
      label: "Services d’appui",
      serviceIds: [assignedServiceId],
    });
    assert.deepEqual(users.get(scopedUser)!.publicMetadata, {
      ...scopedUserMetadataBefore,
      itsmRole: "N4",
      itsmServiceIds: [assignedServiceId],
      itsmBootstrapCompleted: true,
    }, "the assigned N4 role and service scope must be reflected in Clerk metadata");
    const scopedArchivedEvent = archivedRoleEvents.find((event) => event.targetUserId === scopedUser);
    assert.ok(scopedArchivedEvent, "the restricted assignment must be archived");
    assert.equal(scopedArchivedEvent.previousRole, "N5");
    assert.equal(scopedArchivedEvent.nextRole, "N4");
    assert.deepEqual(scopedArchivedEvent.previousServiceIds, []);
    assert.deepEqual(scopedArchivedEvent.serviceIds, [assignedServiceId]);
    assert.equal(scopedArchivedEvent.scope, `Tous les services → ${assignedServiceName}`);
    const { rows: workspaceAfterScopedAssignment } = await pool.query(
      'SELECT store FROM "anif_itsm_workspace" WHERE id = $1',
      [workspaceId],
    );
    const persistedScopedEvent = (workspaceAfterScopedAssignment[0].store.audit as Record<string, unknown>[])
      .find((event) => event.id === scopedArchivedEvent.id);
    assert.ok(persistedScopedEvent, "the N4 assignment must remain in the persisted journal");
    assert.deepEqual({
      previousRole: persistedScopedEvent.previousRole,
      nextRole: persistedScopedEvent.nextRole,
      previousServiceIds: persistedScopedEvent.previousServiceIds,
      serviceIds: persistedScopedEvent.serviceIds,
      scope: persistedScopedEvent.scope,
    }, {
      previousRole: "N5",
      nextRole: "N4",
      previousServiceIds: [],
      serviceIds: [assignedServiceId],
      scope: `Tous les services → ${assignedServiceName}`,
    });

    const clerkMetadataBeforeInvalidAssignment = structuredClone(users.get(nonAdmin)!.publicMetadata);
    const archivedEventsBeforeInvalidAssignment = structuredClone(archivedRoleEvents);
    const { rows: journalBeforeInvalidAssignment } = await pool.query(
      'SELECT store FROM "anif_itsm_workspace" WHERE id = $1',
      [workspaceId],
    );
    const auditBeforeInvalidAssignment = structuredClone(
      journalBeforeInvalidAssignment[0].store.audit,
    );
    const missingServiceResponse = await fetch(endpoint(nonAdmin), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-test-actor": [...users.values()].find((user) => user.publicMetadata.itsmRole === "N1")!.id,
      },
      body: JSON.stringify({
        role: "N2",
        serviceIds: [`${accountPrefix}-missing-service`],
      }),
    });
    assert.equal(missingServiceResponse.status, 400, "an unknown service must be rejected as a client error");
    assert.match((await missingServiceResponse.json()).error, /services autorisés sont introuvables/i);
    assert.deepEqual(
      users.get(nonAdmin)!.publicMetadata,
      clerkMetadataBeforeInvalidAssignment,
      "a rejected assignment must leave the simulated Clerk metadata unchanged",
    );
    assert.deepEqual(
      archivedRoleEvents,
      archivedEventsBeforeInvalidAssignment,
      "a rejected assignment must not add an externally archived event",
    );
    const { rows: journalAfterInvalidAssignment } = await pool.query(
      'SELECT store FROM "anif_itsm_workspace" WHERE id = $1',
      [workspaceId],
    );
    assert.deepEqual(
      journalAfterInvalidAssignment[0].store.audit,
      auditBeforeInvalidAssignment,
      "a rejected assignment must leave the persisted journal unchanged",
    );

    // Hold the same PostgreSQL row lock while a request captures its N1 actor.
    // Downgrade that actor in the Clerk test double before releasing the lock.
    const survivingAdmin = [...users.values()].find((user) => user.publicMetadata.itsmRole === "N1")!;
    blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      'SELECT id FROM "anif_itsm_workspace" WHERE id = $1 FOR UPDATE',
      [workspaceId],
    );
    let resolveActorCaptured!: () => void;
    const actorCaptured = new Promise<void>((resolve) => {
      resolveActorCaptured = resolve;
    });
    onActorResolved = resolveActorCaptured;
    const staleRequest = removeAdmin(survivingAdmin.id, nonAdmin);
    await actorCaptured;
    const targetMetadataBeforeStaleRefusal = structuredClone(users.get(nonAdmin)!.publicMetadata);
    const archivedEventsBeforeStaleRefusal = structuredClone(archivedRoleEvents);
    const { rows: workspaceBeforeStaleRefusal } = await pool.query(
      'SELECT version, store FROM "anif_itsm_workspace" WHERE id = $1',
      [workspaceId],
    );
    survivingAdmin.publicMetadata.itsmRole = "N2";
    await blocker.query("COMMIT");
    blocker.release();
    blocker = undefined;
    assert.equal((await staleRequest).status, 403, "a request carrying a stale N1 snapshot must be refused");
    assert.deepEqual(
      users.get(nonAdmin)!.publicMetadata,
      targetMetadataBeforeStaleRefusal,
      "a request refused after N1 demotion must not change target role metadata",
    );
    assert.deepEqual(
      archivedRoleEvents,
      archivedEventsBeforeStaleRefusal,
      "a request refused after N1 demotion must not create an archived role event",
    );
    const { rows: workspaceAfterStaleRefusal } = await pool.query(
      'SELECT version, store FROM "anif_itsm_workspace" WHERE id = $1',
      [workspaceId],
    );
    assert.deepEqual(
      workspaceAfterStaleRefusal,
      workspaceBeforeStaleRefusal,
      "a request refused after N1 demotion must not mutate the workspace",
    );

    // Clerk failures must be surfaced as an error response, never as HTTP success.
    survivingAdmin.publicMetadata.itsmRole = "N1";
    rejectNextClerkUpdate = true;
    const failedClerkResponse = await removeAdmin(survivingAdmin.id, nonAdmin);
    assert.equal(failedClerkResponse.status, 503);
    assert.notEqual(failedClerkResponse.status, 200);

    // An unavailable archive must be visible to the administrator and must
    // restore the target role instead of leaving an unarchived change applied.
    rejectNextArchiveWrite = true;
    const failedArchiveResponse = await fetch(endpoint(nonAdmin), {
      method: "PUT",
      headers: { "content-type": "application/json", "x-test-actor": survivingAdmin.id },
      body: JSON.stringify({ role: "N3", serviceIds: [] }),
    });
    assert.equal(failedArchiveResponse.status, 503);
    assert.match((await failedArchiveResponse.json()).error, /archive des habilitations.*indisponible/i);
    assert.equal(users.get(nonAdmin)?.publicMetadata.itsmRole, "N5");
  } finally {
    if (blocker) {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
    }
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
      });
    }
    if (pool) {
      await pool.query('DELETE FROM "anif_itsm_workspace" WHERE id = $1', [workspaceId]).catch(() => undefined);
      await pool.end();
    }
    await rm(tempBuildDir, { recursive: true, force: true });
  }
});
