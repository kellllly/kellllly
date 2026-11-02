import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import express from "express";
import { build } from "esbuild";
import {
  DEVELOPMENT_ROLE_ARCHIVE_PATH,
  developmentRoleArchiveConfig,
  developmentRoleArchiveEnabled,
} from "../src/lib/development-role-archive-config.ts";

test("development archive is explicit, HTTPS-only, domain-separated and never enabled in production", () => {
  const env = {
    NODE_ENV: "development",
    ITSM_DEV_ROLE_ARCHIVE_ENABLED: "true",
    ITSM_DEV_ROLE_ARCHIVE_URL: `https://example.test${DEVELOPMENT_ROLE_ARCHIVE_PATH}`,
    SESSION_SECRET: "unit-test-only-not-a-real-credential",
  };
  const config = developmentRoleArchiveConfig(env);
  assert.match(config.headers.Authorization, /^Bearer [a-f0-9]{64}$/);
  assert.ok(!config.headers.Authorization.includes(env.SESSION_SECRET));
  assert.equal(config.headers.Authorization, developmentRoleArchiveConfig(env).headers.Authorization);
  assert.equal(developmentRoleArchiveConfig({
    ...env, ITSM_DEV_ROLE_ARCHIVE_URL: "auto", REPLIT_DEV_DOMAIN: "current-preview.example.test",
  }).endpoint.href, `https://current-preview.example.test${DEVELOPMENT_ROLE_ARCHIVE_PATH}`);
  assert.throws(() => developmentRoleArchiveConfig({ ...env, ITSM_DEV_ROLE_ARCHIVE_URL: "auto" }));
  assert.notEqual(config.headers.Authorization, developmentRoleArchiveConfig({
    ...env, SESSION_SECRET: "different-unit-test-value",
  }).headers.Authorization);
  assert.equal(developmentRoleArchiveEnabled({ ...env, NODE_ENV: "production" }), false);
  assert.throws(() => developmentRoleArchiveConfig({ ...env, NODE_ENV: "production" }));
  assert.throws(() => developmentRoleArchiveConfig({ ...env, ITSM_DEV_ROLE_ARCHIVE_ENABLED: "false" }));
  assert.throws(() => developmentRoleArchiveConfig({ ...env, SESSION_SECRET: undefined }));
  for (const url of [
    "http://example.test/api/itsm/development-role-archive",
    "https://example.test/governance",
    `https://user:password@example.test${DEVELOPMENT_ROLE_ARCHIVE_PATH}`,
    `https://example.test${DEVELOPMENT_ROLE_ARCHIVE_PATH}?token=not-allowed`,
  ]) {
    assert.throws(() => developmentRoleArchiveConfig({ ...env, ITSM_DEV_ROLE_ARCHIVE_URL: url }));
  }
});

test("archive HTTP protocol authenticates, validates, deduplicates and fails closed on storage errors", async () => {
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const tempDir = await mkdtemp(path.join(packageDir, "node_modules/.development-archive-test-"));
  const records = new Map<string, string>();
  let storageUnavailable = false;
  let errorCount = 0;
  try {
    const bundle = path.join(tempDir, "router.mjs");
    await build({
      entryPoints: [path.join(packageDir, "src/routes/development-role-archive.ts")],
      outfile: bundle, bundle: true, platform: "node", format: "esm",
      external: ["express"], logLevel: "silent",
    });
    const { createDevelopmentRoleArchiveRouter } = await import(bundle);
    const app = express();
    app.use("/archive", createDevelopmentRoleArchiveRouter({
      authorization: "Bearer unit-test-only",
      repository: {
        async check() { if (storageUnavailable) throw new Error("unavailable"); },
        async append(envelope: { event: { id: string } }) {
          if (storageUnavailable) throw new Error("unavailable");
          const previous = records.get(envelope.event.id);
          const serialized = JSON.stringify(envelope);
          if (previous) return previous === serialized ? "duplicate" : "conflict";
          records.set(envelope.event.id, serialized);
          return "created";
        },
      },
      onStorageError: () => { errorCount += 1; },
    }));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const url = `http://127.0.0.1:${address.port}/archive`;
      const headers = { Authorization: "Bearer unit-test-only", "Content-Type": "application/json", "Idempotency-Key": "event-test" };
      const envelope = {
        schemaVersion: 1, source: "anif-secure-desk",
        event: {
          id: "event-test", type: "itsm.role.changed", actor: "test-admin", targetUserId: "test-target",
          previousRole: null, nextRole: "N3", previousServiceIds: [], serviceIds: [],
          scope: "Aucun accès → Tous les services", at: "2026-11-02T12:00:00.000Z",
        },
      };
      assert.equal((await fetch(url, { method: "HEAD" })).status, 401);
      assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "Bearer wrong" } })).status, 401);
      assert.equal(records.size, 0);
      assert.equal((await fetch(url, { method: "HEAD", headers })).status, 204);
      const post = (body: unknown, customHeaders = headers) =>
        fetch(url, { method: "POST", headers: customHeaders, body: JSON.stringify(body) });
      assert.equal((await post({})).status, 400);
      assert.equal((await post(envelope, { ...headers, "Idempotency-Key": "wrong" })).status, 400);
      assert.equal((await post({ ...envelope, extra: true })).status, 400);
      assert.equal((await post({ ...envelope, event: { ...envelope.event, at: "not-a-date" } })).status, 400);
      assert.equal((await post({ ...envelope, event: { ...envelope.event, type: "other.event" } })).status, 400);
      assert.deepEqual(await (await post(envelope)).json(), { eventId: "event-test", duplicate: false });
      assert.deepEqual(await (await post(envelope)).json(), { eventId: "event-test", duplicate: true });
      assert.equal((await post({ ...envelope, event: { ...envelope.event, nextRole: "N4" } })).status, 409);
      assert.equal(records.size, 1);
      assert.equal((await fetch(url, { headers })).status, 405);
      assert.equal((await fetch(url, { method: "POST", headers, body: "{" })).status, 400);
      assert.equal((await post({ oversized: "x".repeat(70_000) })).status, 413);
      storageUnavailable = true;
      assert.equal((await fetch(url, { method: "HEAD", headers })).status, 503);
      assert.equal((await post(envelope)).status, 503);
      assert.equal(errorCount, 2);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
