import test from "node:test";
import assert from "node:assert/strict";
import { setPresence, userStoreView } from "../src/lib/itsm-workspace.ts";

type Rec = Record<string, any>;
const t0 = new Date("2026-11-12T10:00:00.000Z");
const me = { id: "user_me", role: "N2" as const, serviceIds: [] };
const colleague = { id: "user_colleague", role: "N2" as const, serviceIds: [] };
const stranger = { id: "user_stranger", role: "N2" as const, serviceIds: [] };
const store = { tickets: [], services: [], assets: [], kedb: [], notifications: [], audit: [], conversations: [
  { id: "C-1", title: "Équipe", kind: "Équipe", classification: "Interne", participants: [], readCount: 0, messages: [{ id: "m1", author: "user_colleague", body: "Bonjour", time: "", at: t0.toISOString() }] },
  { id: "C-2", title: "Enquête", kind: "Enquête", classification: "Restreint", participants: [], memberIds: ["user_stranger"], readCount: 0, messages: [] },
] };

test("an agent sets their own status; it is shown to people sharing a visible conversation, and to themselves", () => {
  let next = setPresence(store, "occupe", colleague, t0) as Rec;
  next = setPresence(next, "absent", stranger, t0) as Rec;
  next = setPresence(next, "disponible", me, t0) as Rec;
  assert.deepEqual(next.presence.user_colleague, { status: "occupe", at: t0.toISOString() });
  const view = userStoreView(next, me, t0) as Rec;
  assert.deepEqual(view.presence, { user_colleague: { status: "occupe", at: t0.toISOString() }, user_me: { status: "disponible", at: t0.toISOString() } },
    "the stranger only appears in a restricted room this account cannot see");
  assert.equal(store.conversations.length, 2, "the input store is not mutated");
  assert.equal("presence" in store, false);
});

test("an unknown status is refused", () => {
  assert.throws(() => setPresence(store, "invisible", me, t0), /Statut de présence inconnu/);
});
