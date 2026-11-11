import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import express from "express";
import { build } from "esbuild";
import {
  AssignItsmRoleResponse,
  CheckItsmRoleArchiveResponse,
  GetItsmUserDirectoryResponse,
  GetItsmWorkspaceResponse,
  ImportItsmExamplesResponse,
  SaveItsmWorkspaceResponse,
} from "../../../lib/api-zod/src/generated/api.ts";
import {
  ITSM_WORKSPACE_VERSION_CONFLICT_MESSAGE,
  saveWorkspaceAtVersion,
} from "../src/lib/itsm-workspace.ts";
import { importWithTestDatabaseUrl } from "./helpers/database-bootstrap.ts";

test("generated ITSM response schemas accept complete values and reject incomplete values", () => {
  const workspace = { store: {}, version: 0 };
  const directory = {
    accounts: [{
      userId: "pilot-user",
      email: null,
      role: "N1",
      serviceIds: [],
      unavailableServiceIds: [],
    }],
    totalCount: 1,
    limit: 10,
    offset: 0,
  };
  const assignment = {
    userId: "pilot-user",
    role: "N2",
    label: "Analyste",
    serviceIds: [],
  };
  const archiveCheck = {
    status: "available",
    message: "L’archive répond à l’adresse configurée.",
    checkedAt: "2026-11-07T12:00:00.000Z",
  };
  const archiveCheckFailure = {
    error: "Impossible de vérifier la connexion à l’archive.",
    checkedAt: "2026-11-07T12:00:00.000Z",
  };

  assert.deepEqual(GetItsmWorkspaceResponse.parse(workspace), workspace);
  assert.deepEqual(SaveItsmWorkspaceResponse.parse(workspace), workspace);
  assert.deepEqual(ImportItsmExamplesResponse.parse(workspace), workspace);
  assert.deepEqual(GetItsmUserDirectoryResponse.parse(directory), directory);
  assert.deepEqual(AssignItsmRoleResponse.parse(assignment), assignment);
  const parsedArchiveCheck = CheckItsmRoleArchiveResponse.parse(archiveCheck);
  assert.deepEqual({ ...parsedArchiveCheck, checkedAt: parsedArchiveCheck.checkedAt.toISOString() }, archiveCheck);
  assert.deepEqual(Object.keys(archiveCheckFailure).sort(), ["checkedAt", "error"]);
  assert.equal(Date.parse(archiveCheckFailure.checkedAt), Date.parse("2026-11-07T12:00:00.000Z"));

  assert.equal(GetItsmWorkspaceResponse.safeParse({ store: {} }).success, false);
  assert.equal(SaveItsmWorkspaceResponse.safeParse({ store: {}, version: -1 }).success, false);
  assert.equal(ImportItsmExamplesResponse.safeParse({ version: 0 }).success, false);
  assert.equal(GetItsmUserDirectoryResponse.safeParse({
    accounts: [{ userId: "pilot-user", email: null }],
    totalCount: 1,
    limit: 10,
    offset: 0,
  }).success, false);
  assert.equal(AssignItsmRoleResponse.safeParse({
    userId: "pilot-user",
    role: "N2",
    serviceIds: [],
  }).success, false);
});

test("stale workspace PUT returns a valid current snapshot and conflict identifiers without PostgreSQL", async () => {
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const tempBuildDir = await mkdtemp(path.join(packageDir, "node_modules", ".itsm-workspace-conflict-contract-"));
  const tempNodeModules = path.join(tempBuildDir, "node_modules");
  await mkdir(tempNodeModules, { recursive: true });
  await symlink(
    path.resolve(packageDir, "../../lib/db/node_modules/pg"),
    path.join(tempNodeModules, "pg"),
  );

  try {
    const bundlePath = path.join(tempBuildDir, "itsm-route.mjs");
    await build({
      entryPoints: [path.join(packageDir, "src/routes/itsm.ts")],
      outfile: bundlePath,
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["@clerk/express", "express", "express-rate-limit", "pkijs", "asn1js", "pino", "pino-http", "pg"],
      sourcemap: false,
      logLevel: "silent",
    });
    const { createItsmWorkspaceSaveRouter } = await importWithTestDatabaseUrl(() => import(pathToFileURL(bundlePath).href));
    const currentStore = { marker: "version-distante" };
    const currentVersion = 8;
    const actor = { id: "pilot-admin", role: "N1" as const, serviceIds: [] };
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.log = { warn: () => undefined, error: () => undefined };
      next();
    });
    app.use(createItsmWorkspaceSaveRouter({
      resolveActor: async () => actor,
      saveWorkspace: async ({ submitted, expectedVersion, actor: resolvedActor }) =>
        saveWorkspaceAtVersion(currentStore, currentVersion, submitted, expectedVersion, resolvedActor),
    }, (_req, _res, next) => next()));

    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      const address = server.address();
      assert.ok(address && typeof address !== "string");

      const response = await fetch(`http://127.0.0.1:${address.port}/itsm`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: currentVersion - 1, store: { marker: "version-client" } }),
      });
      assert.equal(response.status, 409);
      const body: unknown = await response.json();
      assert.ok(body && typeof body === "object");
      assert.deepEqual(Object.keys(body), ["error", "current"]);
      assert.equal((body as { error?: unknown }).error, ITSM_WORKSPACE_VERSION_CONFLICT_MESSAGE);

      const current = (body as { current?: unknown }).current;
      const parsedCurrent = GetItsmWorkspaceResponse.parse(current);
      assert.equal(parsedCurrent.version, currentVersion);
      assert.equal(parsedCurrent.store.marker, currentStore.marker);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    await rm(tempBuildDir, { recursive: true, force: true });
  }
});

test("role assignment HTTP response follows the generated schema without external services", async (t) => {
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const tempBuildDir = await mkdtemp(path.join(packageDir, "node_modules", ".itsm-response-contract-"));
  const tempNodeModules = path.join(tempBuildDir, "node_modules");
  await mkdir(tempNodeModules, { recursive: true });
  await symlink(
    path.resolve(packageDir, "../../lib/db/node_modules/pg"),
    path.join(tempNodeModules, "pg"),
  );

  try {
    const bundlePath = path.join(tempBuildDir, "itsm-route.mjs");
    await build({
      entryPoints: [path.join(packageDir, "src/routes/itsm.ts")],
      outfile: bundlePath,
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["@clerk/express", "express", "express-rate-limit", "pkijs", "asn1js", "pino", "pino-http", "pg"],
      sourcemap: false,
      logLevel: "silent",
    });
    const {
      createItsmRoleArchiveCheckRouter,
      createItsmRoleAssignmentRouter,
      createItsmUserDirectoryRouter,
    } = await importWithTestDatabaseUrl(() => import(pathToFileURL(bundlePath).href));
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.log = { warn: () => undefined, error: () => undefined };
      next();
    });
    let actorRole = "N1";
    let directoryProviderResponse: unknown = {
      data: [
        {
          id: "pilot-user-1",
          primaryEmailAddress: { emailAddress: "analyste@example.test" },
          publicMetadata: { itsmRole: "N4", itsmServiceIds: ["service-a", "retired-service"] },
        },
        {
          id: "pilot-user-2",
          publicMetadata: { itsmRole: "N1", itsmServiceIds: [] },
        },
      ],
      totalCount: 8,
    };
    let directoryProviderOptions: unknown;
    let archiveCheckCount = 0;
    let archiveCheckFails = false;
    const archiveCheckCompletedAt = "2026-11-07T12:00:00.000Z";
    const operationalAlerts: unknown[] = [];
    app.use(createItsmUserDirectoryRouter({
      resolveActor: async () => ({ id: "admin-1", role: actorRole as "N1" | "N2", serviceIds: [] }),
      getUserList: async (options) => {
        directoryProviderOptions = options;
        return directoryProviderResponse;
      },
      getAvailableServiceIds: async () => new Set(["service-a", "service-b"]),
    }, (_req, _res, next) => next()));
    app.use(createItsmRoleArchiveCheckRouter({
      resolveActor: async () => ({ id: "admin-1", role: actorRole as "N1" | "N2", serviceIds: [] }),
      now: () => new Date(archiveCheckCompletedAt),
      checkArchiveConnection: async () => {
        archiveCheckCount += 1;
        if (archiveCheckFails) throw new Error("L’archive a répondu avec HTTP 503.");
      },
    }, (_req, _res, next) => next()));
    app.use(createItsmRoleAssignmentRouter({
      checkStepUp: () => ({ ok: true }),
      resolveActor: async () => ({ id: "admin-1", role: actorRole as "N1" | "N2", serviceIds: [] }),
      getUser: async (userId: string) => ({
        id: userId,
        publicMetadata: {
          itsmRole: userId === "admin-1" ? "N1" : "N5",
          itsmServiceIds: [],
        },
      }),
      activeN1Ids: async () => ["admin-1"],
      updateUserMetadata: async () => undefined,
      archiveRoleChange: async () => undefined,
      reportArchiveUnavailable: () => operationalAlerts.push("archive_unavailable"),
      withLock: async (operation) => operation(
        { services: [] },
        async () => undefined,
      ),
    }, (_req, _res, next) => next()));

    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      const address = server.address();
      assert.ok(address && typeof address !== "string");

      const directoryResponse = await fetch(
        `http://127.0.0.1:${address.port}/itsm/users?q=%20pilot%20&limit=2&offset=3`,
      );
      assert.equal(directoryResponse.status, 200);
      const directoryBody: unknown = await directoryResponse.json();
      assert.deepEqual(GetItsmUserDirectoryResponse.parse(directoryBody), {
        accounts: [
          {
            userId: "pilot-user-1",
            email: "analyste@example.test",
            role: "N4",
            serviceIds: ["retired-service", "service-a"],
            unavailableServiceIds: ["retired-service"],
          },
          {
            userId: "pilot-user-2",
            email: null,
            role: "N1",
            serviceIds: [],
            unavailableServiceIds: [],
          },
        ],
        totalCount: 8,
        limit: 2,
        offset: 3,
      });
      assert.deepEqual(directoryProviderOptions, { limit: 2, offset: 3, query: "pilot" });

      directoryProviderResponse = {
        data: [
          { id: "valid-user", publicMetadata: {} },
          { id: 42, publicMetadata: {} },
        ],
        totalCount: 2,
      };
      const malformedDirectoryResponse = await fetch(
        `http://127.0.0.1:${address.port}/itsm/users?limit=2`,
      );
      assert.equal(malformedDirectoryResponse.status, 503);
      const malformedDirectoryBody: unknown = await malformedDirectoryResponse.json();
      assert.deepEqual(malformedDirectoryBody, {
        error: "Impossible de charger le répertoire des comptes du pilote.",
      });
      assert.equal(
        GetItsmUserDirectoryResponse.safeParse(malformedDirectoryBody).success,
        false,
        "a partially projected provider page must never be returned as a successful directory",
      );

      directoryProviderResponse = { data: "not-a-page", totalCount: 0 };
      const malformedPageResponse = await fetch(
        `http://127.0.0.1:${address.port}/itsm/users`,
      );
      assert.equal(malformedPageResponse.status, 503);
      assert.equal(
        GetItsmUserDirectoryResponse.safeParse(await malformedPageResponse.json()).success,
        false,
      );

      directoryProviderResponse = {
        data: [
          {
            id: "pilot-user-1",
            primaryEmailAddress: { emailAddress: "analyste@example.test" },
            publicMetadata: { itsmRole: "N4", itsmServiceIds: ["service-a", "retired-service"] },
          },
          {
            id: "pilot-user-2",
            publicMetadata: { itsmRole: "N1", itsmServiceIds: [] },
          },
        ],
        totalCount: 8,
      };

      const archiveCheck = await fetch(
        `http://127.0.0.1:${address.port}/itsm/role-archive/check`,
        { method: "POST" },
      );
      assert.equal(archiveCheck.status, 200);
      const archiveCheckBody = CheckItsmRoleArchiveResponse.parse(await archiveCheck.json());
      assert.equal(archiveCheckBody.status, "available");
      assert.equal(archiveCheckBody.message, "L’archive répond à l’adresse configurée.");
      assert.equal(archiveCheckBody.checkedAt.toISOString(), archiveCheckCompletedAt);
      assert.equal(archiveCheckCount, 1);

      actorRole = "N2";
      const forbiddenArchiveCheck = await fetch(
        `http://127.0.0.1:${address.port}/itsm/role-archive/check`,
        { method: "POST" },
      );
      assert.equal(forbiddenArchiveCheck.status, 403);
      assert.equal(archiveCheckCount, 1);
      actorRole = "N1";

      archiveCheckFails = true;
      const unavailableArchiveCheck = await fetch(
        `http://127.0.0.1:${address.port}/itsm/role-archive/check`,
        { method: "POST" },
      );
      assert.equal(unavailableArchiveCheck.status, 503);
      assert.deepEqual(await unavailableArchiveCheck.json(), {
        error: "Impossible de vérifier la connexion à l’archive.",
        checkedAt: archiveCheckCompletedAt,
      });
      assert.equal(archiveCheckCount, 2);
      archiveCheckFails = false;

      const response = await fetch(
        `http://127.0.0.1:${address.port}/itsm/users/target-1/role`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "N2", serviceIds: [] }),
        },
      );
      assert.equal(response.status, 200);
      assert.equal(operationalAlerts.length, 0);
      const body: unknown = await response.json();
      assert.deepEqual(AssignItsmRoleResponse.parse(body), {
        userId: "target-1",
        role: "N2",
        label: "Analyste",
        serviceIds: [],
      });

      actorRole = "N2";
      const forbiddenRoleAssignment = await fetch(
        `http://127.0.0.1:${address.port}/itsm/users/target-1/role`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "N2", serviceIds: [] }),
        },
      );
      assert.equal(forbiddenRoleAssignment.status, 403);
      assert.equal(operationalAlerts.length, 0, "a role denial must not look like an archive outage");
      actorRole = "N1";

      const invalidRequest = await fetch(
        `http://127.0.0.1:${address.port}/itsm/users/target-1/role`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "N2" }),
        },
      );
      assert.equal(invalidRequest.status, 400);
      assert.equal(operationalAlerts.length, 0, "a validation refusal must not look like an archive outage");
      assert.equal(AssignItsmRoleResponse.safeParse(await invalidRequest.json()).success, false);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    await rm(tempBuildDir, { recursive: true, force: true });
  }
});
