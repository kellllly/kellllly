import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

test("generated ITSM response schemas accept complete values and reject incomplete values", () => {
  const workspace = { store: {}, version: 0 };
  const directory = {
    accounts: [{ userId: "pilot-user", email: null, role: "N1", serviceIds: [] }],
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
  };

  assert.deepEqual(GetItsmWorkspaceResponse.parse(workspace), workspace);
  assert.deepEqual(SaveItsmWorkspaceResponse.parse(workspace), workspace);
  assert.deepEqual(ImportItsmExamplesResponse.parse(workspace), workspace);
  assert.deepEqual(GetItsmUserDirectoryResponse.parse(directory), directory);
  assert.deepEqual(AssignItsmRoleResponse.parse(assignment), assignment);
  assert.deepEqual(CheckItsmRoleArchiveResponse.parse(archiveCheck), archiveCheck);

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
      external: ["@clerk/express", "express", "pino", "pino-http", "pg"],
      sourcemap: false,
      logLevel: "silent",
    });
    const { createItsmRoleArchiveCheckRouter, createItsmRoleAssignmentRouter } = await import(bundlePath);
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.log = { warn: () => undefined };
      next();
    });
    let actorRole = "N1";
    let archiveCheckCount = 0;
    let archiveCheckFails = false;
    const operationalAlerts: unknown[] = [];
    app.use(createItsmRoleArchiveCheckRouter({
      resolveActor: async () => ({ id: "admin-1", role: actorRole as "N1" | "N2", serviceIds: [] }),
      checkArchiveConnection: async () => {
        archiveCheckCount += 1;
        if (archiveCheckFails) throw new Error("L’archive a répondu avec HTTP 503.");
      },
    }, (_req, _res, next) => next()));
    app.use(createItsmRoleAssignmentRouter({
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

      const archiveCheck = await fetch(
        `http://127.0.0.1:${address.port}/itsm/role-archive/check`,
        { method: "POST" },
      );
      assert.equal(archiveCheck.status, 200);
      assert.deepEqual(
        CheckItsmRoleArchiveResponse.parse(await archiveCheck.json()),
        { status: "available", message: "L’archive répond à l’adresse configurée." },
      );
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
