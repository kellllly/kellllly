import test from "node:test";
import assert from "node:assert/strict";
import { createSlaBreachMonitor, findNewSlaBreaches, findSlaEscalations, ITSM_SLA_BREACH_AUDIT_TYPE, SENIOR_L2_ASSIGNEE } from "../src/lib/itsm-sla.ts";
import { applyWorkspaceUpdate, recordItsmSlaBreaches } from "../src/lib/itsm-workspace.ts";
import { verifyAuditChain } from "../src/lib/itsm-audit-chain.ts";
import { addItsmBusinessMinutes, DEFAULT_ITSM_SLA_CALENDAR, parseItsmSlaCalendar } from "../src/lib/itsm-sla-calendar.ts";

const opened = "2026-11-09T06:00:00.000Z";
const ticket = (extra: Record<string, unknown> = {}) => ({
  id: "INC-1", priority: "P1", status: "Nouveau", openedAt: opened, acknowledgedAt: null, resolvedAt: null,
  supportLevel: 1, assignee: "Équipe support", serviceId: "svc-1", ...extra,
});
const at = (minutes: number) => new Date(addItsmBusinessMinutes(opened, minutes, DEFAULT_ITSM_SLA_CALENDAR));

test("a P1 is in breach after 15 minutes without acknowledgement, and after 2 hours without resolution", () => {
  assert.deepEqual(findNewSlaBreaches([ticket()], [], at(15)), [], "exactly on time is not a breach");
  assert.deepEqual(findNewSlaBreaches([ticket()], [], at(16)).map((b) => b.deadline), ["acknowledge"]);
  assert.deepEqual(findNewSlaBreaches([ticket()], [], at(121)).map((b) => b.deadline), ["acknowledge", "resolve"]);
  const [breach] = findNewSlaBreaches([ticket()], [], at(16));
  assert.equal(breach!.dueAt, "2026-11-09T06:15:00.000Z");
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
      return { breaches: findNewSlaBreaches([ticket()], [], at(16)) };
    },
    logger: { warn: (fields) => warnings.push(fields), error: (fields) => errors.push(fields) },
  });
  assert.equal((await monitor.checkNow()).length, 1);
  assert.equal((warnings[0] as { alert: string }).alert, "itsm_sla_breached");
  fail = true;
  assert.deepEqual(await monitor.checkNow(), []);
  assert.equal(errors.length, 1);
});

const rules = (tickets: unknown[], minutes: number, audit: unknown[] = []) =>
  findSlaEscalations(tickets, audit, at(minutes)).map((e) => `${e.ticketId}:${e.rule}`);

test("escalation circuit follows the SLA table of the cahier des charges", () => {
  // P1: crisis cell at once, Responsable SI at 80 % of 15 min (12 min).
  assert.deepEqual(rules([ticket()], 1), ["INC-1:p1-crisis"]);
  assert.deepEqual(rules([ticket()], 12), ["INC-1:p1-crisis", "INC-1:approach"]);
  // P2: 80 % of 30 min = 24 min, senior L2 after 45 min.
  const p2 = ticket({ id: "INC-2", priority: "P2" });
  assert.deepEqual(rules([p2], 23), []);
  assert.deepEqual(rules([p2], 24), ["INC-2:approach"]);
  assert.deepEqual(rules([p2], 45), ["INC-2:approach", "INC-2:p2-senior"]);
  // P3: L1 coordinator after 4 h.
  const p3 = ticket({ id: "INC-3", priority: "P3" });
  assert.deepEqual(rules([p3], 239), ["INC-3:approach"]);
  assert.deepEqual(rules([p3], 240), ["INC-3:approach", "INC-3:p3-coordinator"]);
  // Acknowledged, resolved or closed tickets do not escalate (except the P1 crisis cell while open).
  assert.deepEqual(rules([ticket({ id: "INC-4", priority: "P2", acknowledgedAt: at(5).toISOString() })], 60), []);
  assert.deepEqual(rules([ticket({ status: "Résolu" }), ticket({ id: "X", status: "Clos" })], 60), []);
});

test("a P4 waiting three days for the requester is reminded once per waiting period", () => {
  const waiting = ticket({ id: "REQ-1", priority: "P4", status: "En attente", acknowledgedAt: at(10).toISOString(),
    updates: [{ author: "user_a", body: "Précisions demandées", at: at(60).toISOString() }] });
  const reminderAt = at(60).getTime() + 3 * 24 * 60 * 60_000;
  const rulesAt = (time: number) => findSlaEscalations([waiting], [], new Date(time)).map((e) => `${e.ticketId}:${e.rule}`);
  assert.deepEqual(rulesAt(reminderAt - 60_000), []);
  assert.deepEqual(rulesAt(reminderAt), ["REQ-1:p4-reminder"]);
});

test("business deadlines skip weekends and configured holidays", () => {
  const calendar = parseItsmSlaCalendar({
    ...DEFAULT_ITSM_SLA_CALENDAR,
    holidays: ["2026-11-09"],
  });
  const fridayEvening = "2026-11-06T17:55:00.000Z"; // 18:55 in Libreville
  assert.equal(
    addItsmBusinessMinutes(fridayEvening, 15, calendar),
    "2026-11-10T06:10:00.000Z", // Tuesday 07:10 after the Monday holiday
  );
});

test("waiting pauses subtract business minutes from the breach monitor", () => {
  const paused = ticket({
    slaPauses: [{ startedAt: "2026-11-09T06:10:00.000Z", endedAt: "2026-11-09T06:20:00.000Z" }],
  });
  assert.deepEqual(findNewSlaBreaches([paused], [], new Date("2026-11-09T06:20:00.000Z")), []);
  const [breach] = findNewSlaBreaches([paused], [], new Date("2026-11-09T06:26:00.000Z"));
  assert.equal(breach?.deadline, "acknowledge");
  assert.equal(breach?.dueAt, "2026-11-09T06:25:00.000Z");
});

test("escalations are applied once: notification, journal, P2 reassignment and P4 reminder in the ticket history", () => {
  const p2 = ticket({ id: "INC-2", priority: "P2", supportLevel: 1, assignee: "Équipe support" });
  const first = recordItsmSlaBreaches({ tickets: [p2], audit: [], notifications: [] }, at(46));
  assert.deepEqual(first.escalations.map((e) => e.rule), ["approach", "p2-senior"]);
  assert.deepEqual(first.breaches.map((b) => b.deadline), ["acknowledge"]);
  const saved = (first.store.tickets as Array<Record<string, any>>)[0]!;
  assert.equal(saved.assignee, SENIOR_L2_ASSIGNEE);
  assert.equal(saved.supportLevel, 2);
  assert.match(saved.updates.at(-1).body, /réaffecté de Équipe support à Ingénieur senior L2/);
  assert.equal(saved.updates.at(-1).author, "system:sla-monitor");
  assert.equal((first.store.notifications as unknown[]).length, 2);
  assert.equal(verifyAuditChain(first.store.audit).status, "intact");
  const again = recordItsmSlaBreaches(first.store, at(50));
  assert.equal(again.escalations.length, 0);
  assert.equal(again.store, first.store);
});
