import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createRoleReconciliationHandler } from "../src/routes/itsm-role-reconciliation.ts";

const finding = { userId: "user_x", reason: "missing_audit", clerkRole: "N3", clerkServiceIds: [], auditRole: null, auditServiceIds: [] };

test("the reconciliation list is limited to N1 and returns the findings", async (t) => {
  let role: "N1" | "N3" = "N1";
  let fail = false;
  const app = express();
  app.use((req, _res, next) => { (req as unknown as { log: { error: () => void } }).log = { error: () => {} }; next(); });
  app.get("/r", createRoleReconciliationHandler({
    resolveActor: async () => ({ id: "user_admin", role, serviceIds: [] }),
    scan: async () => { if (fail) throw new Error("Clerk down"); return [finding]; },
    now: () => new Date("2026-11-08T12:00:00.000Z"),
  }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/r`;

  const ok = await fetch(url);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.deepEqual(await ok.json(), { checkedAt: "2026-11-08T12:00:00.000Z", findings: [finding] });

  role = "N3";
  assert.equal((await fetch(url)).status, 403);

  role = "N1"; fail = true;
  const unavailable = await fetch(url);
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /Clerk down/);
});
