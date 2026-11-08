import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkspaceUpdate, userStoreView } from "../src/lib/itsm-workspace.ts";

const t0 = new Date("2026-11-08T10:00:00.000Z");
const director = { id: "user_director", role: "N1" as const, serviceIds: [] };
const analyst = { id: "user_analyst", role: "N2" as const, serviceIds: [] };
const support = { id: "user_support", role: "N4" as const, serviceIds: ["SRV-1"] };
const auditor = { id: "user_auditor", role: "N5" as const, serviceIds: [] };
const conv = (id: string, kind: string, extra: Record<string, unknown> = {}) =>
  ({ id, title: id, kind, classification: "Interne", participants: [], readCount: 0, messages: [], ...extra });
const base = () => ({ tickets: [], services: [], assets: [], kedb: [], notifications: [], audit: [], conversations: [
  conv("C-ANN", "Annonce"), conv("C-ADM", "Administratif"), conv("C-EQ", "Équipe"), conv("C-SUP", "Support"),
  conv("C-ENQ", "Enquête", { memberIds: ["user_director"] }),
] });
const ids = (store: Record<string, unknown>, actor: Parameters<typeof userStoreView>[1]) =>
  (userStoreView(store, actor).conversations as Array<{ id: string }>).map((c) => c.id);
type View = { conversations: Array<{ id: string; messages: unknown[] }> };
const post = (store: Record<string, unknown>, actor: Parameters<typeof userStoreView>[1], id: string) => {
  const view = structuredClone(userStoreView(store, actor)) as View;
  view.conversations.find((c) => c.id === id)!.messages.push({ id: "m", body: "Bonjour", time: "" });
  return applyWorkspaceUpdate(store, view, actor, t0);
};

test("N4 sees only administrative rooms and announcements, never investigation or other channels", () => {
  const store = base();
  assert.deepEqual(ids(store, support), ["C-ANN", "C-ADM"]);
  assert.deepEqual(ids(store, auditor), []);
  assert.ok(ids(store, analyst).includes("C-ANN") && ids(store, analyst).includes("C-ADM"));
});

test("N4 writes in an administrative room; the rooms it cannot see stay in place", () => {
  const saved = post(base(), support, "C-ADM");
  const conversations = saved.conversations as Array<{ id: string; messages: Array<Record<string, unknown>> }>;
  assert.deepEqual(conversations.map((c) => c.id), ["C-ANN", "C-ADM", "C-EQ", "C-SUP", "C-ENQ"]);
  assert.equal(conversations[1]!.messages[0]!.author, "user_support");
});

test("only the Direction publishes announcements and opens an announcement channel", () => {
  assert.throws(() => post(base(), support, "C-ANN"), /Seule la Direction/);
  assert.throws(() => post(base(), analyst, "C-ANN"), /Seule la Direction/);
  assert.equal((post(base(), director, "C-ANN").conversations as View["conversations"])[0]!.messages.length, 1);
  const store = base();
  const view = structuredClone(userStoreView(store, analyst)) as View;
  assert.throws(() => applyWorkspaceUpdate(store, { ...view, conversations: [conv("C-NEW", "Annonce"), ...view.conversations] }, analyst, t0), /Seule la Direction/);
});

test("N4 can open an administrative room but no other kind", () => {
  const store = base();
  const view = structuredClone(userStoreView(store, support)) as View;
  const created = applyWorkspaceUpdate(store, { ...view, conversations: [conv("C-NEW", "Administratif"), ...view.conversations] }, support, t0);
  assert.ok(ids(created, support).includes("C-NEW"));
  for (const kind of ["Équipe", "Groupe", "Support", "Enquête"]) {
    assert.throws(() => applyWorkspaceUpdate(store, { ...view, conversations: [conv("C-X", kind), ...view.conversations] }, support, t0), /salon administratif|N1/);
  }
});

test("N4 cannot reach a hidden channel by sending its identifier", () => {
  const store = base();
  const view = structuredClone(userStoreView(store, support)) as View;
  const forged = { ...view, conversations: [...view.conversations, { ...conv("C-EQ", "Équipe"), messages: [{ id: "x", body: "Intrusion", time: "" }] }] };
  assert.throws(() => applyWorkspaceUpdate(store, forged, support, t0), /pas accessible/);
});

test("the announcements channel and the support services room are opened once, on an existing workspace only", async () => {
  const { ensureSupportServiceChannels } = await import("../src/lib/itsm-workspace.ts");
  assert.equal(ensureSupportServiceChannels({}), null, "a fresh workspace keeps the browser seed");
  const store = { conversations: [conv("C-EQ", "Équipe")] };
  const next = ensureSupportServiceChannels(store, t0)!;
  assert.deepEqual((next.conversations as Array<{ id: string; kind: string }>).map((c) => [c.id, c.kind]), [["C-ANN", "Annonce"], ["C-ADM", "Administratif"], ["C-EQ", "Équipe"]]);
  assert.equal(ensureSupportServiceChannels(next, t0), null);
});
