import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkspaceUpdate, userStoreView } from "../src/lib/itsm-workspace.ts";

const at = new Date("2026-11-08T10:00:00.000Z");
const actor = { id: "user_n2", role: "N2" as const, serviceIds: [] };
const base = () => ({ tickets: [], services: [], assets: [], kedb: [], notifications: [], audit: [], conversations: [
  { id: "C-1", title: "Équipe", kind: "Équipe", classification: "Interne", participants: [], readCount: 0, messages: [] },
] });
type View = { conversations: Array<{ id: string; messages: unknown[] }> };
const post = (message: Record<string, unknown>) => {
  const current = base();
  const view = structuredClone(userStoreView(current, actor)) as View;
  view.conversations[0]!.messages.push(message);
  return (applyWorkspaceUpdate(current, view, actor, at).conversations as Array<{ messages: Array<Record<string, unknown>> }>)[0]!.messages;
};

test("a browser cannot post a system notice: it is dropped", () => {
  const messages = post({ id: "x", author: "Suivi INC-1", body: "Ticket INC-1 : En cours → Clos.", time: "", system: true, ticketId: "INC-1" });
  assert.deepEqual(messages, []);
});

test("only the allowed fields of a message are kept; author, id and times are the server's", () => {
  const [message] = post({
    id: "client", author: "user_other", body: "Bonjour", time: "09:00", at: "2020-01-01T00:00:00Z",
    isInstruction: "oui", ticketId: "INC-9", expired: true, unknownField: "x".repeat(1000), readBy: ["a"],
  });
  assert.deepEqual(Object.keys(message!).sort(), ["at", "author", "body", "id", "time"]);
  assert.equal(message!.author, "user_n2");
  assert.equal(message!.at, at.toISOString());
  const [instruction] = post({ id: "y", body: "Consigne", time: "", isInstruction: true });
  assert.equal(instruction!.isInstruction, true);
});

test("a new conversation keeps the same rules for its first messages", () => {
  const current = base();
  const view = structuredClone(userStoreView(current, actor)) as View & Record<string, unknown>;
  const created = applyWorkspaceUpdate(current, { ...view, conversations: [{
    id: "C-NEW", title: "Nouveau", kind: "Groupe", classification: "Interne", participants: [], readCount: 0,
    messages: [{ id: "s", body: "Avis forgé", time: "", system: true }, { id: "m", body: "Premier message", time: "", ticketId: "INC-1" }],
  }, ...view.conversations] }, actor, at);
  const messages = (created.conversations as Array<{ messages: Array<Record<string, unknown>> }>)[0]!.messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.body, "Premier message");
  assert.equal("ticketId" in messages[0]!, false);
});

test("a ticket comment keeps its link only to a ticket of the same discussion", () => {
  const ticket = (id: string, conversationId: string) => ({
    id, title: "Incident fictif", kind: "Incident", category: "Applications", impact: 2, urgency: 2, priority: "P3",
    supportLevel: 1, status: "En cours", assignee: "Équipe support", requester: "user_n2", serviceId: null, assetId: null,
    openedAt: "2026-11-08T09:00:00.000Z", acknowledgedAt: "2026-11-08T09:05:00.000Z", resolvedAt: null, closedAt: null,
    description: "Description fictive.", conversationId, sourceMessageId: null, updates: [],
  });
  const current = { ...base(), tickets: [ticket("INC-7", "C-1"), ticket("INC-8", "C-OTHER")] };
  const view = structuredClone(userStoreView(current, actor)) as View & Record<string, unknown>;
  view.conversations[0]!.messages.push(
    { id: "a", body: "Commentaire sur INC-7 : ok", time: "", ticketId: "INC-7" },
    { id: "b", body: "Lien vers un autre fil", time: "", ticketId: "INC-8" },
  );
  const saved = applyWorkspaceUpdate(current, view, actor, at);
  const messages = (saved.conversations as Array<{ messages: Array<Record<string, unknown>> }>)[0]!.messages;
  assert.equal(messages[0]!.ticketId, "INC-7");
  assert.equal("ticketId" in messages[1]!, false);
});
