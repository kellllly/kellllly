import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAuditRateLimit } from "../src/lib/itsm-rate-limit.ts";

test("the journal quota is counted per account and answers 429 in French once spent", async (t) => {
  const app = express();
  app.get("/audit", createAuditRateLimit({ accountOf: (req) => String(req.headers["x-account"] ?? "") || null, limit: 3 }), (_req, res) => {
    res.json({ ok: true });
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const call = (account: string) => fetch(`http://127.0.0.1:${address.port}/audit`, { headers: { "x-account": account } });

  for (let i = 0; i < 3; i += 1) assert.equal((await call("user_a")).status, 200);
  const refused = await call("user_a");
  assert.equal(refused.status, 429);
  assert.match((await refused.json()).error, /Patientez une minute/u);
  assert.ok(refused.headers.get("ratelimit-policy"), "standard rate-limit headers are sent");
  assert.equal((await call("user_b")).status, 200, "another account keeps its own quota");
});
