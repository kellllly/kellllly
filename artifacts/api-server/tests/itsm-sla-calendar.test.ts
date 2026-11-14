import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkspaceUpdate, recordItsmSlaBreaches } from "../src/lib/itsm-workspace.ts";
import {
  addItsmBusinessMinutes,
  DEFAULT_ITSM_SLA_CALENDAR,
  parseItsmSlaCalendar,
} from "../src/lib/itsm-sla-calendar.ts";

const now = new Date("2026-11-09T06:00:00.000Z");
const actor = (role: "N1" | "N2" | "N3" = "N1") => ({ id: "user-test", role, serviceIds: ["service-1"] });
const empty = () => ({
  schema: 2,
  tickets: [],
  conversations: [],
  audit: [],
  kedb: [],
  services: [],
  assets: [],
  notifications: [],
  seeded: [],
});

test("server validates the work calendar and skips holidays when adding business minutes", () => {
  const calendar = parseItsmSlaCalendar({ ...DEFAULT_ITSM_SLA_CALENDAR, holidays: ["2026-11-09"] });
  assert.equal(addItsmBusinessMinutes("2026-11-06T17:55:00.000Z", 15, calendar), "2026-11-10T06:10:00.000Z");
  assert.throws(() => parseItsmSlaCalendar({ ...calendar, holidays: ["2026-02-30"] }), /jours fériés uniques/);
});

test("only N1 can change holidays, and the server records the calendar change", () => {
  const current = empty();
  const submitted = {
    ...current,
    slaCalendar: { ...DEFAULT_ITSM_SLA_CALENDAR, holidays: ["2026-12-25"] },
  };
  assert.throws(() => applyWorkspaceUpdate(current, submitted, actor("N3"), now), /Seul un compte N1/);
  const saved = applyWorkspaceUpdate(current, submitted, actor("N1"), now);
  assert.deepEqual(saved.slaCalendar, submitted.slaCalendar);
  assert.equal((saved.audit as Array<Record<string, unknown>>)[0]?.type, "itsm.sla.calendar.changed");
});

test("server timestamps the waiting pause and ignores client-supplied pause history", () => {
  const initial = empty();
  initial.services.push({ id: "service-1", name: "Service de test", category: "Applications" });
  let store = applyWorkspaceUpdate(initial, {
    ...initial,
    tickets: [{
      id: "INC-4001", title: "Test SLA", kind: "Incident", category: "Applications",
      impact: 1, urgency: 1, priority: "P1", supportLevel: 1, status: "Nouveau",
      assignee: "Équipe support", requester: "requester", serviceId: "service-1", assetId: null,
      openedAt: "2000-01-01T00:00:00.000Z", acknowledgedAt: null, resolvedAt: null,
      description: "Incident de test avec un contenu suffisant.", updates: [],
    }],
  }, actor("N3"), now);
  let ticket = (store.tickets as Array<Record<string, unknown>>)[0]!;
  store = applyWorkspaceUpdate(store, { ...store, tickets: [{ ...ticket, status: "Pris en compte" }] }, actor("N3"), now);
  ticket = (store.tickets as Array<Record<string, unknown>>)[0]!;
  const pausedAt = new Date(now.getTime() + 60_000);
  store = applyWorkspaceUpdate(store, {
    ...store,
    tickets: [{ ...ticket, status: "En attente", slaPauses: [{ startedAt: "2000-01-01T00:00:00.000Z" }] }],
  }, actor("N3"), pausedAt);
  ticket = (store.tickets as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual(ticket.slaPauses, [{ startedAt: pausedAt.toISOString() }]);

  const attemptedTamper = [{ startedAt: "2000-01-01T00:00:00.000Z", endedAt: "2000-01-02T00:00:00.000Z" }];
  const next = applyWorkspaceUpdate(store, {
    ...store,
    tickets: [{ ...ticket, slaPauses: attemptedTamper }],
  }, actor("N3"), new Date(pausedAt.getTime() + 60_000));
  assert.deepEqual((next.tickets as Array<Record<string, unknown>>)[0]?.slaPauses, [{ startedAt: pausedAt.toISOString() }]);
});

test("the monitor starts a server-owned pause for legacy tickets already waiting", () => {
  const waitingAt = new Date("2026-11-09T06:10:00.000Z");
  const waitingTicket = {
    id: "INC-4002", priority: "P1", status: "En attente", openedAt: "2026-11-09T06:00:00.000Z",
    acknowledgedAt: null, resolvedAt: null,
  };
  const first = recordItsmSlaBreaches({
    tickets: [waitingTicket], audit: [], slaCalendar: DEFAULT_ITSM_SLA_CALENDAR,
  }, waitingAt);
  assert.deepEqual((first.store.tickets as Array<Record<string, unknown>>)[0]?.slaPauses, [
    { startedAt: waitingAt.toISOString() },
  ]);
  assert.equal((first.store.audit as Array<Record<string, unknown>>)[0]?.type, "itsm.sla.pause.started");
  assert.equal(first.breaches.length, 0);
  const next = recordItsmSlaBreaches(first.store, new Date(waitingAt.getTime() + 10 * 60_000));
  assert.equal(next.breaches.length, 0);
});
