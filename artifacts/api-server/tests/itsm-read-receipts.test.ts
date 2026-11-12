import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkspaceUpdate, userStoreView } from "../src/lib/itsm-workspace.ts";

type Rec = Record<string, any>;
const t0 = new Date("2026-11-12T10:00:00.000Z");
const later = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const analyst = { id: "user_analyst", role: "N2" as const, serviceIds: [] };
const other = { id: "user_other", role: "N2" as const, serviceIds: [] };
const third = { id: "user_third", role: "N2" as const, serviceIds: [] };

/** The analyst posts two messages; returns the stored workspace. */
function twoMessages() {
  const empty = { tickets: [], services: [], assets: [], kedb: [], notifications: [], audit: [], conversations: [
    { id: "C-1", title: "Équipe", kind: "Équipe", classification: "Interne", participants: [], readCount: 0, messages: [] },
  ] };
  const one = applyWorkspaceUpdate(empty, { ...empty, conversations: [{ ...empty.conversations[0], messages: [{ body: "Premier" }] }] }, analyst, t0) as Rec;
  const view = userStoreView(one, analyst, later(1)) as Rec;
  return applyWorkspaceUpdate(one, { ...view, conversations: [{ ...view.conversations[0], messages: [...view.conversations[0].messages, { body: "Second" }] }] }, analyst, later(1)) as Rec;
}
/** `actor` opens C-1 having read `count` messages. */
function read(store: Rec, actor: typeof other, count: number, at: Date) {
  const view = userStoreView(store, actor, at) as Rec;
  return applyWorkspaceUpdate(store, { ...view, conversations: [{ ...view.conversations[0], readCount: count }] }, actor, at) as Rec;
}

test("readers are reported to the conversation's authors, by the time of the last message they read", () => {
  let store = twoMessages();
  const [first, second] = store.conversations[0].messages.map((m: Rec) => m.at);
  store = read(store, other, 1, later(2));
  store = read(store, third, 2, later(3));
  const view = userStoreView(store, analyst, later(4)) as Rec;
  assert.deepEqual(view.conversations[0].readBy, { user_other: first, user_third: second });
  assert.equal("readReceipts" in view, false, "the raw table is never sent");
  assert.equal("readBy" in (userStoreView(store, other, later(4)) as Rec).conversations[0], false, "only someone who wrote in the conversation sees who read it");
});

test("marking a conversation unread does not withdraw a receipt, and a forged readBy is ignored", () => {
  let store = twoMessages();
  const second = store.conversations[0].messages[1].at;
  store = read(store, other, 2, later(2));
  store = read(store, other, 0, later(3));
  assert.equal((userStoreView(store, analyst, later(4)) as Rec).conversations[0].readBy.user_other, second);

  const view = userStoreView(store, analyst, later(5)) as Rec;
  const forged = applyWorkspaceUpdate(store, { ...view, conversations: [{ ...view.conversations[0], readBy: { user_ghost: second, user_other: "2099-01-01T00:00:00.000Z" } }] }, analyst, later(5)) as Rec;
  assert.equal("readBy" in forged.conversations[0], false, "readBy is never stored with the conversation");
  assert.deepEqual((userStoreView(forged, analyst, later(6)) as Rec).conversations[0].readBy, { user_other: second });
});
