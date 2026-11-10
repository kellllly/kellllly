/**
 * Tests written from the surviving mutants of the first mutation run
 * (stryker.config.json): each one pins a rule that a mutated program broke
 * without any test noticing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  auditEventHash, isKeptWholeAuditType, isPrunedAuditEvent, pruneAuditEvent, sealAuditEvents, verifyAuditChain,
} from "../src/lib/itsm-audit-chain.ts";
import { isSeal, merkleInclusionProof, merkleRoot, verifyMerkleInclusion } from "../src/lib/itsm-audit-merkle.ts";
import { siemPage, toSiemRecord } from "../src/lib/itsm-audit-siem.ts";
import { evaluateStepUp, requireSecondFactorFromEnv } from "../src/lib/itsm-step-up.ts";

const event = (id: string, extra: Record<string, unknown> = {}) => ({ id, action: `Action ${id}`, actor: "user_a", scope: "Pilote", time: "10:00", ...extra });
const seal = (i: number) => createHash("sha256").update(`s${i}`).digest("hex");

test("the seal is computed on canonical JSON: key order, even nested, does not change it", () => {
  const a = { id: "x", action: "A", nested: { b: 2, a: 1, list: [{ z: 1, y: 2 }] } };
  const b = { nested: { list: [{ y: 2, z: 1 }], a: 1, b: 2 }, action: "A", id: "x" };
  assert.equal(auditEventHash(a), auditEventHash(b));
  assert.notEqual(auditEventHash(a), auditEventHash({ ...a, nested: { ...a.nested, a: 9 } }));
  // A sealed event whose stored keys were reordered still verifies.
  const [sealed] = sealAuditEvents([event("a", { meta: { y: 1, x: 2 } })]);
  const reordered = Object.fromEntries(Object.entries(sealed!).reverse());
  assert.equal(verifyAuditChain([reordered]).status, "intact");
});

test("only events with a positive integer sequence and a hash count as sealed", () => {
  const [good] = sealAuditEvents([event("a")]);
  for (const bad of [{ ...good, seq: 0 }, { ...good, seq: -1 }, { ...good, seq: 1.5 }, { ...good, seq: "1" }, { ...good, hash: undefined }]) {
    assert.equal(verifyAuditChain([bad]).status, "unsealed", JSON.stringify({ seq: bad.seq, hash: typeof bad.hash }));
    assert.equal(verifyAuditChain([good, { ...bad, id: "b" }]).firstBreak?.reason, "Événement sans sceau");
  }
});

test("kept-whole types and pruned stubs are recognised exactly", () => {
  assert.equal(isKeptWholeAuditType("itsm.role.changed"), true);
  assert.equal(isKeptWholeAuditType("itsm.audit.timestamped"), true);
  for (const other of ["itsm.sla.breached", "x.itsm.role.", "itsm.audit.timestamped.extra", undefined, 3]) {
    assert.equal(isKeptWholeAuditType(other), false, String(other));
  }
  assert.equal(isPrunedAuditEvent({ pruned: true }), true);
  assert.equal(isPrunedAuditEvent({ pruned: "true" }), false);
  assert.equal(isPrunedAuditEvent(null), false);
});

test("pruning out of archive order is a break, but kept-whole events may sit among stubs", () => {
  const chain = sealAuditEvents(["d", "c", "b", "a"].map((id) => event(id)));
  const bySeq = (seq: number) => chain.find((item) => item.seq === seq)!;
  // Oldest ordinary events pruned first: fine.
  const ordered = chain.map((item) => (item.seq === 1 ? pruneAuditEvent(item) : item));
  assert.equal(verifyAuditChain(ordered).status, "intact");
  // A newer ordinary event pruned while an older one is kept whole: hidden content.
  const outOfOrder = chain.map((item) => (item.seq === 3 ? pruneAuditEvent(item) : item));
  const report = verifyAuditChain(outOfOrder);
  assert.equal(report.status, "broken");
  assert.equal(report.firstBreak?.reason, "Événement purgé hors de l’ordre d’archivage");
  assert.equal(report.firstBreak?.seq, 3);
  // A role change or timestamp kept whole before pruned stubs is not a break.
  const kept = sealAuditEvents([event("c"), event("b"), event("a", { type: "itsm.audit.timestamped" })]);
  const stubs = kept.map((item) => (item.seq === 2 ? pruneAuditEvent(item) : item));
  assert.equal(verifyAuditChain(stubs).status, "intact");
  assert.equal(bySeq(4).id, "d");
});

test("a malformed seal, root, index or size never verifies, and the proof builder rejects out-of-range input", () => {
  assert.equal(isSeal(seal(1)), true);
  for (const bad of [`x${seal(1)}`, `${seal(1)}x`, seal(1).toUpperCase(), seal(1).slice(1), 42]) assert.equal(isSeal(bad), false, String(bad));
  const seals = [seal(1), seal(2), seal(3)];
  const root = merkleRoot(seals);
  const proof = merkleInclusionProof(seals, 1);
  assert.equal(verifyMerkleInclusion(seals[1]!, 1, 3, proof, root), true);
  for (const [s, i, n, r] of [
    [`${seals[1]}0`, 1, 3, root], [seals[1], 1, 3, root.toUpperCase()], [seals[1], -1, 3, root], [seals[1], 3, 3, root],
    [seals[1], 1.5, 3, root], [seals[1], 1, 3.5, root], [seals[1], 1, 0, root],
  ] as const) {
    assert.equal(verifyMerkleInclusion(s, i, n, proof, r), false, `${String(i)}/${String(n)}`);
  }
  assert.equal(verifyMerkleInclusion(seals[1]!, 1, 3, ["not-a-seal", ...proof.slice(1)], root), false);
  assert.equal(verifyMerkleInclusion(seals[0]!, 0, 1, [seal(9)], merkleRoot([seals[0]!])), false, "a proof longer than the tree is refused");
  for (const [i, n] of [[-1, 3], [3, 3], [0, 4], [1.5, 3], [0, 2.5]] as const) {
    assert.throws(() => merkleInclusionProof(seals, i, n), RangeError, `${i}/${n}`);
  }
  assert.equal(merkleRoot(seals, 2), merkleRoot(seals.slice(0, 2)), "a smaller tree uses only its first leaves");
});

test("SIEM categories follow the event type, and empty or invalid values are left out", () => {
  const map = (type?: string) => (toSiemRecord(event("e", type ? { type } : {})).event as Record<string, unknown>);
  assert.deepEqual([map("itsm.role.changed").category, map("itsm.role.changed").type], [["iam"], ["change"]]);
  assert.deepEqual([map("itsm.role.attested").category, map("itsm.role.attested").type], [["iam"], ["info"]]);
  assert.deepEqual([map("itsm.sla.breached").category, map("itsm.sla.breached").type], [["process"], ["info"]]);
  assert.deepEqual([map("itsm.messages.expired").category, map("itsm.messages.expired").type], [["file"], ["deletion"]]);
  assert.deepEqual([map().category, map().type, map().action], [["configuration"], ["change"], "itsm.activity"]);
  const record = toSiemRecord({ id: "f", action: "", actor: "", ticketId: "INC-1", supportLevel: "L2", serviceIds: ["SVC-1", 3, null], escalationKey: "k", conversationId: "C-1", count: 2, at: "2026-11-10T10:00:00.000Z" });
  assert.equal("message" in record, false, "an empty action is not exported");
  assert.equal("user" in record, false, "an empty actor is not exported");
  assert.deepEqual(record.observer, { vendor: "ANIF Gabon", product: "Poste de pilotage ITSM", type: "application" });
  const anif = record.anif as Record<string, Record<string, unknown>>;
  assert.deepEqual(anif.ticket, { id: "INC-1", support_level: "L2" });
  assert.deepEqual(anif.role, { service_ids: ["SVC-1"] }, "non-string ids are dropped");
  assert.deepEqual(anif.sla, { escalation_key: "k" });
  assert.deepEqual(anif.conversation, { id: "C-1" });
  assert.equal(anif.count, 2);
  assert.equal((toSiemRecord({ id: "g", supportLevel: 2 }).anif as Record<string, Record<string, unknown>>).ticket!.support_level, 2);
  // Garbage in the stored journal is skipped, not a crash.
  const page = siemPage([null, "x", 3, ...sealAuditEvents([event("a")])], 0, 10);
  assert.equal(page.lines.length, 1);
});

test("the second-factor option is read from ITSM_REQUIRE_SECOND_FACTOR=true only, and asks Clerk for strict_mfa", () => {
  assert.equal(requireSecondFactorFromEnv({ ITSM_REQUIRE_SECOND_FACTOR: "true" }), true);
  for (const value of [undefined, "false", "1", "TRUE", ""]) assert.equal(requireSecondFactorFromEnv({ ITSM_REQUIRE_SECOND_FACTOR: value }), false, String(value));
  const asked: string[] = [];
  const has = ({ reverification }: { reverification: string }) => { asked.push(reverification); return true; };
  evaluateStepUp({ factorVerificationAge: [1, 1], has }, { requireSecondFactor: true });
  evaluateStepUp({ factorVerificationAge: [1, -1], has }, { requireSecondFactor: false });
  assert.deepEqual(asked, ["strict_mfa", "strict"]);
  const refused = evaluateStepUp({ factorVerificationAge: [1, 1], has: () => false }, { requireSecondFactor: true });
  assert.deepEqual(!refused.ok && (refused.body as { clerk_error: { metadata: unknown } }).clerk_error.metadata, { reverification: "strict_mfa" });
  assert.match(String(!refused.ok && refused.body.error), /10 minutes/u);
});
