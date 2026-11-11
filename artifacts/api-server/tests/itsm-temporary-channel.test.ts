import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkspaceUpdate, canSeeConversation, postTemporaryChannelMessage, userStoreView } from "../src/lib/itsm-workspace.ts";
import { verifyAuditChain } from "../src/lib/itsm-audit-chain.ts";

const t0 = new Date("2026-11-08T10:00:00.000Z");
const hours = (h: number) => new Date(t0.getTime() + h * 3_600_000);
const n1 = { id: "user_director", role: "N1" as const, serviceIds: [] };
const auditor = { id: "user_auditor", role: "N5" as const, serviceIds: [] };
const otherAuditor = { id: "user_other", role: "N5" as const, serviceIds: [] };
const ssi = { id: "user_ssi", role: "N3" as const, serviceIds: [] };
const empty = () => ({ tickets: [], services: [], assets: [], kedb: [], notifications: [], audit: [], conversations: [
  { id: "C-1", title: "Équipe", kind: "Équipe", classification: "Interne", participants: [], readCount: 0, messages: [] },
] });
const channel = { id: "C-T1", title: "Mission GABAC", kind: "Temporaire", classification: "Interne", participants: [], memberIds: ["user_auditor"], durationHours: 48, readCount: 0, messages: [] };
const open = () => {
  const current = empty();
  return applyWorkspaceUpdate(current, { ...current, conversations: [channel, ...current.conversations] }, n1, t0);
};

test("only N1 opens a temporary channel; it is restricted and ends after the chosen duration (1 h to 30 days)", () => {
  const current = empty();
  assert.throws(() => applyWorkspaceUpdate(current, { ...current, conversations: [channel, ...current.conversations] }, ssi, t0), /Seul un compte N1/);
  const room = (open().conversations as Array<Record<string, unknown>>)[0]!;
  assert.equal(room.classification, "Restreint");
  assert.deepEqual(room.memberIds, ["user_director", "user_auditor"]);
  assert.equal(room.expiresAt, hours(48).toISOString());
  const long = applyWorkspaceUpdate(current, { ...current, conversations: [{ ...channel, durationHours: 9999 }, ...current.conversations] }, n1, t0);
  assert.equal((long.conversations as Array<Record<string, unknown>>)[0]!.expiresAt, hours(720).toISOString());
});

test("an invited auditor sees only its temporary channel, until the end date", () => {
  const store = open();
  // Fixed date inside the 48 h mission: the test must not depend on today's date.
  const ids = (actor: Parameters<typeof userStoreView>[1]) => (userStoreView(store, actor, hours(1)).conversations as Array<{ id: string }>).map((c) => c.id);
  assert.deepEqual(ids(auditor), ["C-T1"]);
  assert.deepEqual(ids(otherAuditor), []);
  assert.deepEqual(ids(ssi), ["C-1"], "a temporary channel is not open to non-members");
  const room = (store.conversations as Array<Record<string, unknown>>)[0]!;
  assert.equal(canSeeConversation(auditor, room, hours(47)), true);
  assert.equal(canSeeConversation(auditor, room, hours(49)), false);
  assert.equal(canSeeConversation(n1, room, hours(49)), true, "N1 keeps the record after closure");
});

test("a temporary channel without a valid expiry is closed to auditors but retained for N1", () => {
  const missingExpiry = { ...channel };
  delete (missingExpiry as Partial<typeof channel> & { expiresAt?: string }).expiresAt;
  const invalidExpiries = [
    missingExpiry,
    { ...channel, expiresAt: "not-a-date" },
    { ...channel, expiresAt: "" },
  ];
  for (const room of invalidExpiries) {
    const store = { ...empty(), conversations: [room] };
    assert.equal(canSeeConversation(auditor, room, hours(1)), false);
    assert.deepEqual(userStoreView(store, auditor, hours(1)).conversations, []);
    assert.equal(canSeeConversation(n1, room, hours(1)), true, "N1 retains access to the record");
    assert.throws(
      () => postTemporaryChannelMessage(store, "C-T1", "Message refusé", auditor, hours(1)),
      /pas accessible/,
    );
  }
});

test("an auditor posts through the dedicated command; the post is journaled; closed channels refuse messages", () => {
  const store = open();
  const posted = postTemporaryChannelMessage(store, "C-T1", "  Pièce reçue, analyse en cours.  ", auditor, hours(1));
  const room = (posted.conversations as Array<{ messages: Array<Record<string, unknown>> }>)[0]!;
  assert.equal(room.messages.at(-1)!.author, "user_auditor");
  assert.equal(room.messages.at(-1)!.body, "Pièce reçue, analyse en cours.");
  const audit = posted.audit as Array<Record<string, unknown>>;
  assert.match(String(audit[0]!.action), /canal temporaire C-T1/);
  assert.equal(verifyAuditChain(audit).status, "intact");
  assert.throws(() => postTemporaryChannelMessage(store, "C-T1", "Trop tard", auditor, hours(49)), /pas accessible/);
  assert.throws(() => postTemporaryChannelMessage(store, "C-T1", "Hors mission", otherAuditor, hours(1)), /pas accessible/);
  assert.throws(() => postTemporaryChannelMessage(store, "C-1", "Canal pérenne", auditor, hours(1)), /pas accessible/);
  assert.throws(() => postTemporaryChannelMessage(store, "C-T1", "   ", auditor, hours(1)), /vide/);
  const view = structuredClone(userStoreView(store, n1, hours(49))) as { conversations: Array<{ id: string; messages: unknown[] }> };
  view.conversations.find((c) => c.id === "C-T1")!.messages.push({ id: "x", body: "Après clôture", time: "" });
  assert.throws(() => applyWorkspaceUpdate(store, view, n1, hours(49)), /clos/);
});
