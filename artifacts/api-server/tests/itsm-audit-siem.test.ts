import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { pruneAuditEvent, sealAuditEvents } from "../src/lib/itsm-audit-chain.ts";
import { siemPage, toSiemRecord } from "../src/lib/itsm-audit-siem.ts";
import { createItsmAuditSiemHandler } from "../src/routes/itsm-audit-export.ts";

const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id, action: `Action ${id}`, actor: "user_a", scope: "Pilote", time: "10:00", at: "2026-11-09T10:00:00.000Z", ...extra,
});

test("a role change maps to ECS fields with its seal", () => {
  const [sealed] = sealAuditEvents([event("r", {
    type: "itsm.role.changed", targetUserId: "user_b", previousRole: "N2", nextRole: "N3",
    previousServiceIds: [], serviceIds: ["SVC-01"],
  })]);
  const record = toSiemRecord(sealed!);
  assert.equal(record["@timestamp"], "2026-11-09T10:00:00.000Z");
  assert.equal(record.message, "Action r");
  assert.deepEqual(record.event, { id: "r", kind: "event", dataset: "anif.itsm.audit", action: "itsm.role.changed", category: ["iam"], type: ["change"], sequence: 1 });
  assert.deepEqual(record.user, { id: "user_a", target: { id: "user_b" } });
  const anif = record.anif as Record<string, Record<string, unknown>>;
  assert.deepEqual(anif.role, { previous: "N2", next: "N3", previous_service_ids: [], service_ids: ["SVC-01"] });
  assert.equal(anif.seal!.hash, sealed!.hash);
  assert.equal("ticket" in anif, false, "empty groups are left out");
});

test("a revocation keeps next: null, and unmapped fields never leave the pilot", () => {
  const record = toSiemRecord({ ...event("x"), type: "itsm.role.changed", nextRole: null, secret: "ne pas exporter" });
  assert.equal((record.anif as Record<string, Record<string, unknown>>).role!.next, null);
  assert.doesNotMatch(JSON.stringify(record), /ne pas exporter/u);
  assert.equal((record.event as Record<string, unknown>).action, "itsm.role.changed");
  assert.equal((toSiemRecord(event("y")).event as Record<string, unknown>).action, "itsm.activity");
});

test("service-request decisions enter SIEM without exporting free-text rejection reasons", () => {
  const rejected = toSiemRecord({
    ...event("request"),
    type: "itsm.request.rejected",
    ticketId: "REQ-2601",
    reason: "Texte privé à ne pas exporter.",
  });
  assert.deepEqual(rejected.event, {
    id: "request",
    kind: "event",
    dataset: "anif.itsm.audit",
    action: "itsm.request.rejected",
    category: ["process"],
    type: ["change"],
  });
  assert.doesNotMatch(JSON.stringify(rejected), /Texte privé à ne pas exporter/u);
  assert.deepEqual((rejected.anif as Record<string, unknown>).ticket, { id: "REQ-2601" });
});

test("pages follow the sequence, skip pruned stubs and move the cursor past them", () => {
  const sealed = sealAuditEvents(["e", "d", "c", "b", "a"].map((id) => event(id)));
  const journal = sealed.map((item) => (item.seq === 2 ? pruneAuditEvent(item) : item));
  const first = siemPage(journal, 0, 2);
  assert.deepEqual(first.lines.map((line) => JSON.parse(line).event.sequence), [1, 3], "the pruned event 2 is passed, not sent");
  assert.equal(first.next, 3);
  const second = siemPage(journal, first.next, 2);
  assert.deepEqual(second.lines.map((line) => JSON.parse(line).event.sequence), [4, 5]);
  const last = second;
  const idle = siemPage(journal, last.next, 2);
  assert.deepEqual(idle, { lines: [], next: 5, head: 5 });
});

test("the SIEM route streams NDJSON with cursor and chain headers, for export roles only", async (t) => {
  let role: "N1" | "N2" = "N1";
  let journal = sealAuditEvents(["c", "b", "a"].map((id) => event(id)));
  const app = express();
  app.get("/siem", createItsmAuditSiemHandler({
    resolveActor: async () => ({ id: "user_x", role, serviceIds: [] }),
    loadAuditEvents: async () => journal,
  }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/siem`;

  const response = await fetch(`${base}?after=1&limit=10`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/x-ndjson/u);
  assert.equal(response.headers.get("x-anif-next-after"), "3");
  assert.equal(response.headers.get("x-anif-journal-head"), "3");
  assert.equal(response.headers.get("x-anif-chain-status"), "intact");
  const lines = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.event.id), ["b", "c"]);

  journal = journal.map((item) => (item.id === "a" ? { ...item, action: "réécrit" } : item));
  const broken = await fetch(base);
  assert.equal(broken.headers.get("x-anif-chain-status"), "broken");

  for (const query of ["?after=-1", "?after=abc", "?limit=0", "?limit=1001"]) {
    assert.equal((await fetch(base + query)).status, 400, query);
  }
  role = "N2";
  assert.equal((await fetch(base)).status, 403);
});
