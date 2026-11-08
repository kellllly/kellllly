import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkspaceUpdate, canSeeConversation, userStoreView } from "../src/lib/itsm-workspace.ts";

const n1 = { id: "user_director", role: "N1" as const, serviceIds: [] };
const analyst = { id: "user_analyst", role: "N2" as const, serviceIds: [] };
const otherAnalyst = { id: "user_other", role: "N2" as const, serviceIds: [] };
const ssi = { id: "user_ssi", role: "N3" as const, serviceIds: [] };
const base = () => ({ tickets: [], services: [], assets: [], kedb: [], notifications: [], audit: [], conversations: [
  { id: "C-1", title: "Équipe", kind: "Équipe", classification: "Interne", participants: [], readCount: 0, messages: [] },
] });
const newRoom = { id: "C-9", title: "Dossier 2026-14", kind: "Enquête", classification: "Interne", participants: ["Direction"], memberIds: ["user_analyst", "not-an-id"], readCount: 0, messages: [{ id: "m", body: "Ouverture", time: "" }] };

const withRoom = () => {
  const current = base();
  return applyWorkspaceUpdate(current, { ...current, conversations: [newRoom, ...current.conversations] }, n1);
};

test("only N1 opens an investigation room; it is forced to Restreint with the creator and valid members", () => {
  const current = base();
  for (const actor of [analyst, ssi]) {
    assert.throws(() => applyWorkspaceUpdate(current, { ...current, conversations: [newRoom, ...current.conversations] }, actor),
      /Seul un compte N1/);
  }
  const room = (withRoom().conversations as Array<Record<string, unknown>>)[0]!;
  assert.equal(room.classification, "Restreint");
  assert.deepEqual(room.memberIds, ["user_director", "user_analyst"]);
});

test("investigation rooms are visible to N1 and invited N2 only, never to N3, N4 or N5", () => {
  const store = withRoom();
  const ids = (actor: Parameters<typeof userStoreView>[1]) =>
    (userStoreView(store, actor).conversations as Array<{ id: string }>).map((c) => c.id);
  assert.deepEqual(ids(n1), ["C-9", "C-1"]);
  assert.deepEqual(ids(analyst), ["C-9", "C-1"]);
  assert.deepEqual(ids(otherAnalyst), ["C-1"]);
  assert.deepEqual(ids(ssi), ["C-1"]);
  assert.equal(canSeeConversation({ id: "x", role: "N4" }, { kind: "Équipe" }), false);
  assert.equal(canSeeConversation({ id: "x", role: "N5" }, { kind: "Enquête", memberIds: ["x"] }), false);
});

test("saving without a hidden room keeps it intact, and a hidden room cannot be targeted", () => {
  const store = withRoom();
  const ssiView = structuredClone(userStoreView(store, ssi));
  const saved = applyWorkspaceUpdate(store, ssiView, ssi);
  assert.deepEqual((saved.conversations as Array<{ id: string }>).map((c) => c.id), ["C-9", "C-1"]);
  assert.deepEqual((saved.conversations as unknown[])[0], (store.conversations as unknown[])[0]);
  const forged = { ...ssiView, conversations: [(store.conversations as unknown[])[0], ...(ssiView.conversations as unknown[])] };
  assert.throws(() => applyWorkspaceUpdate(store, forged, ssi), /pas accessible/);
});

test("an invited analyst can post in the room; an analyst who is not invited cannot see it", () => {
  const store = withRoom();
  const view = structuredClone(userStoreView(store, analyst)) as { conversations: Array<{ id: string; messages: unknown[] }> };
  view.conversations[0]!.messages.push({ id: "client", body: "Analyse du relevé", time: "" });
  const saved = applyWorkspaceUpdate(store, view, analyst);
  const room = (saved.conversations as Array<{ id: string; messages: Array<{ author: string; body: string }> }>)[0]!;
  assert.equal(room.messages.at(-1)!.author, "user_analyst");
  assert.equal(room.messages.at(-1)!.body, "Analyse du relevé");
});

test("a ticket status change is posted in its linked discussion", () => {
  const ssiActor = { id: "user_ssi", role: "N3" as const, serviceIds: [] };
  const current = {
    tickets: [{ id: "INC-1", title: "Imprimante", kind: "Incident", category: "Équipement", impact: 2, urgency: 2, priority: "P3", supportLevel: 1, status: "Nouveau", assignee: "Équipe support", requester: "user_a", serviceId: null, assetId: null, openedAt: "2026-11-08T08:00:00.000Z", acknowledgedAt: null, resolvedAt: null, closedAt: null, description: "Panne", cab: null, updates: [], conversationId: "C-SUP" }],
    services: [], assets: [], kedb: [], notifications: [], audit: [],
    conversations: [{ id: "C-SUP", title: "Support", kind: "Support", classification: "Interne", participants: [], readCount: 0, messages: [] }],
  };
  const submitted = structuredClone(current) as typeof current;
  submitted.tickets[0]!.status = "Pris en compte";
  const saved = applyWorkspaceUpdate(current, submitted, ssiActor, new Date("2026-11-08T08:05:00.000Z"));
  const messages = (saved.conversations as Array<{ messages: Array<Record<string, unknown>> }>)[0]!.messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.body, "Ticket INC-1 : Nouveau → Pris en compte.");
  assert.equal(messages[0]!.system, true);
  assert.equal((current.conversations[0]!.messages as unknown[]).length, 0, "the stored state is not mutated");
});
