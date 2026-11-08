import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkspaceUpdate, userStoreView } from "../src/lib/itsm-workspace.ts";
import { contactsFromClerkUsers } from "../src/lib/itsm-people.ts";

const t0 = new Date("2026-11-08T10:00:00.000Z");
const analyst = { id: "user_analyst", role: "N2" as const, serviceIds: [] };
const engineer = { id: "user_engineer", role: "N3" as const, serviceIds: [] };
const director = { id: "user_director", role: "N1" as const, serviceIds: [] };
const support = { id: "user_support", role: "N4" as const, serviceIds: [] };
const auditor = { id: "user_auditor", role: "N5" as const, serviceIds: [] };
const empty = () => ({ tickets: [], services: [], assets: [], kedb: [], notifications: [], audit: [], conversations: [
  { id: "C-1", title: "Équipe", kind: "Équipe", classification: "Interne", participants: [], readCount: 0, messages: [] },
] });
const direct = (memberIds: string[], id = "C-D1") => ({ id, title: "Échange", kind: "Direct", classification: "Interne", participants: ["x"], memberIds, readCount: 0, messages: [] });
const withDirect = () => {
  const current = empty();
  return applyWorkspaceUpdate(current, { ...current, conversations: [direct(["user_engineer"]), ...current.conversations] }, analyst, t0);
};
const ids = (store: Record<string, unknown>, actor: Parameters<typeof userStoreView>[1]) =>
  (userStoreView(store, actor).conversations as Array<{ id: string }>).map((c) => c.id);

test("a bilateral channel joins exactly the creator and one colleague, and is confidential", () => {
  const room = (withDirect().conversations as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual(room.memberIds, ["user_analyst", "user_engineer"]);
  assert.deepEqual(room.participants, ["user_analyst", "user_engineer"]);
  assert.equal(room.classification, "Confidentiel");
  const current = empty();
  const create = (memberIds: string[], actor = analyst) =>
    applyWorkspaceUpdate(current, { ...current, conversations: [direct(memberIds), ...current.conversations] }, actor, t0);
  assert.throws(() => create([]), /exactement deux/);
  assert.throws(() => create(["user_analyst"]), /exactement deux/, "a channel with oneself is refused");
  assert.throws(() => create(["user_engineer", "user_director"]), /exactement deux/);
  assert.throws(() => create(["not-a-clerk-id"]), /exactement deux/);
});

test("only the two agents see it, not even the Direction", () => {
  const store = withDirect();
  assert.deepEqual(ids(store, analyst), ["C-D1", "C-1"]);
  assert.deepEqual(ids(store, engineer), ["C-D1", "C-1"]);
  assert.deepEqual(ids(store, director), ["C-1"]);
  assert.deepEqual(ids(store, support), []);
  assert.deepEqual(ids(store, auditor), []);
});

test("an outsider saves without seeing it, and cannot open a second channel for the same pair", () => {
  const store = withDirect();
  const view = structuredClone(userStoreView(store, director)) as { conversations: Array<{ id: string; messages: unknown[] }> };
  view.conversations.find((c) => c.id === "C-1")!.messages.push({ id: "m", body: "Bonjour", time: "" });
  const saved = applyWorkspaceUpdate(store, view, director, t0);
  assert.deepEqual((saved.conversations as Array<{ id: string }>).map((c) => c.id), ["C-D1", "C-1"]);
  const mine = structuredClone(userStoreView(store, engineer)) as { conversations: unknown[] };
  assert.throws(() => applyWorkspaceUpdate(store, { ...mine, conversations: [direct(["user_analyst"], "C-D2"), ...mine.conversations] }, engineer, t0), /existe déjà/);
});

test("N4 and N5 accounts cannot open a bilateral channel", () => {
  const current = empty();
  assert.throws(() => applyWorkspaceUpdate(current, { ...current, conversations: [direct(["user_engineer"]), ...current.conversations] }, auditor, t0));
  assert.throws(() => applyWorkspaceUpdate({ ...current, conversations: [] }, { ...current, conversations: [direct(["user_engineer"])] }, support, t0));
});

test("contacts are other named N1–N3 accounts, searched on the name only", () => {
  const users = [
    { id: "user_a", firstName: "Aïcha", lastName: "Mba", publicMetadata: { itsmRole: "N2" } },
    { id: "user_b", firstName: "Bruno", lastName: "Ndong", publicMetadata: { itsmRole: "N3" } },
    { id: "user_c", firstName: "Carine", lastName: "Obame", publicMetadata: { itsmRole: "N4" } },
    { id: "user_d", firstName: "Denis", lastName: "Ella", publicMetadata: { itsmRole: "N5" } },
    { id: "user_e", firstName: null, lastName: null, publicMetadata: { itsmRole: "N1" } },
    { id: "user_me", firstName: "Moi", lastName: "Même", publicMetadata: { itsmRole: "N1" } },
    { id: "user_f", firstName: "Fanny", lastName: "Essono", publicMetadata: {} },
  ];
  assert.deepEqual(contactsFromClerkUsers(users, "user_me", ""), [
    { userId: "user_a", name: "Aïcha Mba", role: "N2" },
    { userId: "user_b", name: "Bruno Ndong", role: "N3" },
  ]);
  assert.deepEqual(contactsFromClerkUsers(users, "user_me", "aicha").map((c) => c.userId), ["user_a"]);
  assert.deepEqual(contactsFromClerkUsers(users, "user_me", "ndong bru").map((c) => c.userId), ["user_b"]);
  assert.deepEqual(contactsFromClerkUsers(users, "user_me", "user_a"), [], "identifiers and e-mails are not searchable");
});
