import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  AUDIT_CHAIN_GENESIS,
  auditEventHash,
  pruneAuditEvent,
  sealAuditEvents,
  verifyAuditChain,
} from "../src/lib/itsm-audit-chain.ts";
import { applyWorkspaceUpdate } from "../src/lib/itsm-workspace.ts";
import { createItsmAuditIntegrityHandler } from "../src/routes/itsm-audit-export.ts";

const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id, action: `Action ${id}`, actor: "user_a", scope: "Pilote", time: "10:00", ...extra,
});

test("legacy journals are sealed oldest first and verify as intact", () => {
  // The journal is stored newest first.
  const sealed = sealAuditEvents([event("c"), event("b"), event("a")]);
  assert.deepEqual(sealed.map((item) => [item.id, item.seq]), [["c", 3], ["b", 2], ["a", 1]]);
  assert.equal(sealed[2]!.prevHash, AUDIT_CHAIN_GENESIS);
  assert.equal(sealed[1]!.prevHash, sealed[2]!.hash);
  assert.equal(sealed[0]!.hash, auditEventHash(sealed[0]!));
  const report = verifyAuditChain(sealed);
  assert.equal(report.status, "intact");
  assert.equal(report.verified, 3);
  assert.deepEqual(report.head, { seq: 3, hash: sealed[0]!.hash });
});

test("new events extend the chain without resealing existing ones", () => {
  const first = sealAuditEvents([event("b"), event("a")]);
  const next = sealAuditEvents([event("d"), event("c"), ...first]);
  assert.deepEqual(next.slice(2), first, "existing seals must not change");
  assert.deepEqual(next.map((item) => item.seq), [4, 3, 2, 1]);
  assert.equal(next[1]!.prevHash, first[0]!.hash);
  assert.equal(verifyAuditChain(next).status, "intact");
});

test("an edited, removed or reordered event breaks the chain", () => {
  const sealed = sealAuditEvents([event("c"), event("b"), event("a")]);

  const edited = structuredClone(sealed);
  edited[1]!.action = "Action réécrite";
  const editedReport = verifyAuditChain(edited);
  assert.equal(editedReport.status, "broken");
  assert.deepEqual(editedReport.firstBreak, { seq: 2, eventId: "b", reason: "Contenu modifié après scellement" });

  const removed = [sealed[0]!, sealed[2]!];
  assert.match(verifyAuditChain(removed).firstBreak?.reason ?? "", /Séquence manquante avant 3/);

  const swapped = structuredClone(sealed);
  [swapped[0]!.seq, swapped[1]!.seq] = [swapped[1]!.seq, swapped[0]!.seq];
  assert.equal(verifyAuditChain(swapped).status, "broken");

  const recomputedLeaf = structuredClone(sealed);
  recomputedLeaf[1]!.action = "Action réécrite";
  recomputedLeaf[1]!.hash = auditEventHash(recomputedLeaf[1]!);
  assert.equal(verifyAuditChain(recomputedLeaf).firstBreak?.reason, "Lien vers l’événement précédent incorrect");
});

test("pruned stubs keep the chain verifiable, but only for the oldest ordinary events", () => {
  const sealed = sealAuditEvents([event("d"), event("c"), event("b"), event("a")]);
  const oldestPruned = [sealed[0]!, sealed[1]!, pruneAuditEvent(sealed[2]!), pruneAuditEvent(sealed[3]!)];
  const report = verifyAuditChain(oldestPruned);
  assert.equal(report.status, "intact");
  assert.equal(report.pruned, 2);
  assert.equal(report.verified, 2);

  const hiddenRecent = [pruneAuditEvent(sealed[0]!), sealed[1]!, sealed[2]!, sealed[3]!];
  assert.equal(verifyAuditChain(hiddenRecent).firstBreak?.reason, "Événement purgé hors de l’ordre d’archivage");
});

test("an unsealed event and an empty journal are reported", () => {
  assert.equal(verifyAuditChain([]).status, "empty");
  const sealed = sealAuditEvents([event("a")]);
  assert.equal(verifyAuditChain([event("x"), ...sealed]).firstBreak?.reason, "Événement sans sceau");
});

test("saving the workspace seals journal additions and ignores seals sent by a client", () => {
  const actor = { id: "user_n1", role: "N1" as const, serviceIds: [] };
  const current = { tickets: [], conversations: [], services: [], assets: [], kedb: [], notifications: [], audit: sealAuditEvents([event("a")]) };
  const forged = {
    ...current,
    audit: [
      { ...event("client-added"), seq: 99, prevHash: "f".repeat(64), hash: "e".repeat(64), pruned: false },
      ...current.audit,
    ],
  };
  const next = applyWorkspaceUpdate(current, forged, actor);
  const audit = next.audit as Array<Record<string, unknown>>;
  assert.equal(audit.length, 2);
  assert.equal(audit[0]!.seq, 2);
  assert.equal(audit[0]!.prevHash, current.audit[0]!.hash);
  assert.notEqual(audit[0]!.hash, "e".repeat(64));
  assert.equal("pruned" in audit[0]!, false);
  assert.equal(verifyAuditChain(audit).status, "intact");
});

test("the integrity route is limited to export roles and returns only seals", async (t) => {
  let role: "N1" | "N2" = "N1";
  const app = express();
  app.get("/audit/integrity", createItsmAuditIntegrityHandler({
    resolveActor: async () => ({ id: "user_x", role, serviceIds: [] }),
    loadAuditEvents: async () => sealAuditEvents([event("secret-content")]),
    now: () => new Date("2026-11-07T12:00:00.000Z"),
  }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/audit/integrity`;

  const response = await fetch(url);
  const body = await response.text();
  assert.equal(response.status, 200);
  const report = JSON.parse(body);
  assert.equal(report.status, "intact");
  assert.equal(report.checkedAt, "2026-11-07T12:00:00.000Z");
  assert.doesNotMatch(body, /secret-content|Action/);

  role = "N2";
  const refused = await fetch(url);
  assert.equal(refused.status, 403);
});
