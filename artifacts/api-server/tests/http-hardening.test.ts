import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import cors from "cors";
import {
  ITSM_JSON_BODY_LIMIT,
  allowedCorsOrigins,
  corsOptions,
  securityHeaders,
} from "../src/lib/http-hardening.ts";

async function listen(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test("a workspace holding the maximum 5000 audit events can still be saved", async (t) => {
  const audit = Array.from({ length: 5000 }, (_, index) => ({
    id: crypto.randomUUID(),
    action: `Ticket INC-${2400 + index} ouvert depuis la vue générale`,
    actor: "user_2abcdefghijklmnopqrstuvwxyz1",
    scope: "Support informatique",
    at: new Date().toISOString(),
    time: "10:00",
  }));
  const body = JSON.stringify({ store: { audit }, version: 1 });
  assert.ok(body.length > 100 * 1024, "the fixture must exceed Express's default 100 KB limit");

  const app = express();
  app.use(express.json({ limit: ITSM_JSON_BODY_LIMIT }));
  app.put("/itsm", (req, res) => { res.json({ count: req.body.store.audit.length }); });
  const { server, url } = await listen(app);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const response = await fetch(`${url}/itsm`, {
    method: "PUT", headers: { "content-type": "application/json" }, body,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { count: 5000 });
});

test("CORS reflects only configured origins and stays same-origin by default", async (t) => {
  assert.deepEqual(allowedCorsOrigins({}), []);
  assert.deepEqual(
    allowedCorsOrigins({
      CORS_ALLOWED_ORIGINS: " https://pilote.example.test ,https://pilote.example.test/,invalid",
      REPLIT_DOMAINS: "anif.replit.app",
    }),
    ["https://pilote.example.test", "https://anif.replit.app"],
  );

  const app = express();
  app.use(cors(corsOptions({ CORS_ALLOWED_ORIGINS: "https://pilote.example.test" })));
  app.get("/probe", (_req, res) => { res.json({ ok: true }); });
  const { server, url } = await listen(app);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const trusted = await fetch(`${url}/probe`, { headers: { origin: "https://pilote.example.test" } });
  assert.equal(trusted.headers.get("access-control-allow-origin"), "https://pilote.example.test");
  assert.equal(trusted.headers.get("access-control-allow-credentials"), "true");

  const hostile = await fetch(`${url}/probe`, { headers: { origin: "https://attacker.example.test" } });
  assert.equal(hostile.headers.get("access-control-allow-origin"), null);
  assert.equal(hostile.headers.get("access-control-allow-credentials"), null);
});

test("API responses carry defensive security headers", async (t) => {
  const app = express();
  app.use(securityHeaders);
  app.get("/probe", (_req, res) => { res.json({ ok: true }); });
  const { server, url } = await listen(app);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const response = await fetch(`${url}/probe`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("unexpected errors return a generic JSON body without stack traces", async (t) => {
  const { jsonErrorHandler } = await import("../src/lib/http-hardening.ts");
  const logged: unknown[] = [];
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  app.get("/boom", () => { throw new Error("secret detail at /srv/internal/file.ts:12"); });
  app.post("/big", (_req, res) => { res.json({ ok: true }); });
  app.use(jsonErrorHandler({ error: (fields) => logged.push(fields) }));
  const { server, url } = await listen(app);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const boom = await fetch(`${url}/boom`);
  const text = await boom.text();
  assert.equal(boom.status, 500);
  assert.match(boom.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(JSON.parse(text), { error: "Erreur interne du serveur." });
  assert.doesNotMatch(text, /secret detail|internal|\.ts/);
  assert.equal(logged.length, 1);

  const big = await fetch(`${url}/big`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ x: "y".repeat(5000) }),
  });
  assert.equal(big.status, 413);
  assert.deepEqual(await big.json(), { error: "Requête trop volumineuse." });
  assert.equal(logged.length, 1, "client errors are not logged as server failures");
});

test("a missing Clerk secret is detected so auth routes answer 503 instead of crashing", async (t) => {
  const { authNotConfigured, isAuthConfigured, AUTH_NOT_CONFIGURED_MESSAGE } = await import("../src/lib/http-hardening.ts");
  assert.equal(isAuthConfigured({}), false);
  assert.equal(isAuthConfigured({ CLERK_SECRET_KEY: "  " }), false);
  assert.equal(isAuthConfigured({ CLERK_SECRET_KEY: "sk_test_x" }), true);
  const app = express();
  app.use("/api", authNotConfigured);
  const { server, url } = await listen(app);
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const response = await fetch(`${url}/api/itsm`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: AUTH_NOT_CONFIGURED_MESSAGE });
});
