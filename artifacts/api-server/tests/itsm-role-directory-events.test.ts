import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { build } from "esbuild";

test("directory event stream is N1-only, sends minimal role updates, and closes after demotion", async () => {
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const tempBuildDir = await mkdtemp(path.join(packageDir, "node_modules", ".itsm-role-directory-events-"));
  await mkdir(path.join(tempBuildDir, "node_modules"), { recursive: true });
  await symlink(
    path.resolve(packageDir, "../../lib/db/node_modules/pg"),
    path.join(tempBuildDir, "node_modules/pg"),
  );
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    const bundlePath = path.join(tempBuildDir, "itsm-role-directory-events.mjs");
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
    const { createItsmRoleDirectoryEventsRouter, publishItsmRoleDirectoryEvent } = await import(pathToFileURL(bundlePath).href);
    const app = express();
    let sessionRole: "N1" | "N2" = "N1";
    let currentRole: "N1" | "N2" | "N3" | "N4" | "N5" | null = "N1";
    app.use(createItsmRoleDirectoryEventsRouter({
      resolveActor: async () => ({
        id: "session-account",
        role: sessionRole,
        serviceIds: [],
      }),
      getUser: async () => ({
        publicMetadata: {
          itsmRole: currentRole,
          itsmServiceIds: ["must-not-be-sent"],
          privateMetadata: { secret: "must-not-be-sent" },
        },
      }),
      heartbeatMs: 60_000,
    }, (_req, _res, next) => next()));

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/itsm/users/events`;

    sessionRole = "N2";
    const denied = await fetch(url);
    assert.equal(denied.status, 403);
    assert.match(denied.headers.get("content-type") ?? "", /application\/json/);
    await denied.body?.cancel();

    sessionRole = "N1";
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    reader = response.body?.getReader();
    assert.ok(reader);

    const readUntil = async (marker: string): Promise<string> => {
      let body = "";
      const deadline = Date.now() + 2_000;
      while (!body.includes(marker) && Date.now() < deadline) {
        const next = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Timed out waiting for ${marker}`)),
            Math.max(1, deadline - Date.now()),
          );
          reader!.read().then((value) => {
            clearTimeout(timer);
            resolve(value);
          }, reject);
        });
        if (next.done) break;
        body += new TextDecoder().decode(next.value);
      }
      return body;
    };

    publishItsmRoleDirectoryEvent({ userId: "target-account", role: "N3" });
    const roleEvent = await readUntil("event: directory-refresh");
    const dataLine = roleEvent.split("\n").find(line => line.startsWith("data: "));
    assert.ok(dataLine);
    const payload = JSON.parse(dataLine.slice("data: ".length));
    assert.deepEqual(payload, { userId: "target-account", role: "N3" });

    currentRole = "N2";
    publishItsmRoleDirectoryEvent({ userId: "target-account", role: "N2" });
    const revokedEvent = await readUntil("event: access-revoked");
    assert.match(revokedEvent, /event: access-revoked\ndata: \{\}/);
    assert.doesNotMatch(revokedEvent, /must-not-be-sent|privateMetadata|secret/);
  } finally {
    await reader?.cancel();
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
      });
    }
    await rm(tempBuildDir, { recursive: true, force: true });
  }
});
