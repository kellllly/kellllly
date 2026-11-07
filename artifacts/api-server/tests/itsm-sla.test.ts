import test from "node:test";
import assert from "node:assert/strict";
import { createSlaBreachMonitor, findNewSlaBreaches, ITSM_SLA_BREACH_AUDIT_TYPE } from "../src/lib/itsm-sla.ts";
import { applyWorkspaceUpdate, recordItsmSlaBreaches } from "../src/lib/itsm-workspace.ts";
import { verifyAuditChain } from "../src/lib/itsm-audit-chain.ts";

const opened = "2026-11-07T08:00:00.000Z";
const ticket = (extra: Record<string, unknown> = {}) => ({
  id: "INC-1", priority: "P1", status: "Nouveau", openedAt: opened, acknowledgedAt: null, resolvedAt: null,
  supportLevel: 1, assignee: "Équipe support", serviceId: "svc-1", ...extra,
});
const at = (minutes: number) => new Date(Date.parse(opened) + minutes * 60_000);

test("a P1 is in breach after 15 minutes without acknowledgement, and after 2 hours without resolution", () => {
  assert.deepEqual(findNewSlaBreaches([ticket()], [], at(15)), [], "exactly on time is not a breach");
  assert.deepEqual(findNewSlaBreaches([ticket()], [], at(16)).map((b) => b.deadline), ["acknowledge"]);
  assert.deepEqual(findNewSlaBreaches([ticket()], [], at(121)).map((b) => b.deadline), ["acknowledge", "resolve"]);
  const [breach] = findNewSlaBreaches([ticket()], [], at(16));
  assert.equal(breach!.dueAt, "2026-11-07T08:15:00.000Z");
});

test("on-time completion, closed tickets and already recorded breaches are skipped; late completion is kept", () => {
  assert.deepEqual(findNewSlaBreaches([ticket({ acknowledgedAt: at(10).toISOString() })], [], at(30)), []);
  assert.deepEqual(findNewSlaBreaches([ticket({ status: "Clos" })], [], at(500)), []);
  assert.deepEqual(findNewSlaBreaches([ticket({ status: "Rejeté" })], [], at(500)), []);
  const late = findNewSlaBreaches([ticket({ acknowledgedAt: at(20).toISOString(), status: "En cours" })], [], at(30));
  assert.deepEqual(late.map((b) => b.deadline), ["acknowledge"]);
  const recorded = [{ type: ITSM_SLA_BREACH_AUDIT_TYPE, ticketId: "INC-1", deadline: "acknowledge" }];
  assert.deepEqual(findNewSlaBreaches([ticket()], recorded, at(30)), []);
  assert.deepEqual(findNewSlaBreaches([ticket({ priority: "P9" }), { id: 3 }], [], at(9000)), []);
});

test("breaches are journaled once, sealed in the chain, and not repeated", () => {
  const store = { tickets: [ticket()], audit: [] };
  const first = recordItsmSlaBreaches(store, at(16));
  assert.equal(first.breaches.length, 1);
  const audit = first.store.audit as Array<Record<string, unknown>>;
  assert.equal(audit[0]!.type, ITSM_SLA_BREACH_AUDIT_TYPE);
  assert.equal(audit[0]!.actor, "system:sla-monitor");
  assert.match(String(audit[0]!.action), /Délai de prise en charge dépassé pour INC-1 \(P1\)/);
  assert.equal(verifyAuditChain(audit).status, "intact");
  const again = recordItsmSlaBreaches(first.store, at(17));
  assert.equal(again.breaches.length, 0);
  assert.equal(again.store, first.store, "no write when nothing is new");
});

test("a browser cannot add system journal events such as a fake SLA breach", () => {
  const current = { tickets: [], conversations: [], services: [], assets: [], kedb: [], notifications: [], audit: [] };
  const actor = { id: "user_n1", role: "N1" as const, serviceIds: [] };
  assert.throws(() => applyWorkspaceUpdate(current, {
    ...current,
    audit: [{ id: "fake", type: ITSM_SLA_BREACH_AUDIT_TYPE, ticketId: "INC-1", deadline: "acknowledge", action: "x", scope: "x", time: "x" }],
  }, actor), /créés uniquement par le serveur/);
});

test("the monitor logs each new breach and survives a failed check", async () => {
  const warnings: unknown[] = [];
  const errors: unknown[] = [];
  let fail = false;
  const monitor = createSlaBreachMonitor({
    recordNow: async () => {
      if (fail) throw new Error("db down");
      return findNewSlaBreaches([ticket()], [], at(16));
    },
    logger: { warn: (fields) => warnings.push(fields), error: (fields) => errors.push(fields) },
  });
  assert.equal((await monitor.checkNow()).length, 1);
  assert.equal((warnings[0] as { alert: string }).alert, "itsm_sla_breached");
  fail = true;
  assert.deepEqual(await monitor.checkNow(), []);
  assert.equal(errors.length, 1);
});
