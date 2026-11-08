import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkspaceUpdate, purgeExpiredMessages } from "../src/lib/itsm-workspace.ts";
import { verifyAuditChain } from "../src/lib/itsm-audit-chain.ts";

const actor = { id: "user_n2", role: "N2" as const, serviceIds: [] };
const t0 = new Date("2026-11-08T10:00:00.000Z");
const later = (seconds: number) => new Date(t0.getTime() + seconds * 1000);
const empty = () => ({ tickets: [], services: [], assets: [], kedb: [], notifications: [], audit: [], conversations: [
  { id: "C-1", title: "Équipe", kind: "Équipe", classification: "Interne", participants: [], readCount: 0, messages: [] },
] });
const send = (store: Record<string, unknown>, body: string, extra: Record<string, unknown> = {}, at = t0) => {
  const next = structuredClone(store) as { conversations: Array<{ messages: unknown[] }> };
  next.conversations[0]!.messages.push({ id: "client", body, time: "", ...extra });
  return applyWorkspaceUpdate(store, next, actor, at);
};
const messages = (store: Record<string, unknown>) =>
  (store.conversations as Array<{ messages: Array<Record<string, unknown>> }>)[0]!.messages;

test("the sender sets a lifetime between 30 seconds and 30 days; the server computes the expiry", () => {
  let store = send(empty(), "Bref", { ttlSeconds: 5 });
  assert.equal(messages(store)[0]!.ttlSeconds, 30, "below 30 s is raised to 30 s");
  assert.equal(messages(store)[0]!.expiresAt, later(30).toISOString());
  store = send(store, "Long", { ttlSeconds: 90 * 24 * 3600, expiresAt: "2099-01-01T00:00:00.000Z", expired: true });
  assert.equal(messages(store)[1]!.ttlSeconds, 30 * 24 * 3600, "above 30 days is capped");
  assert.equal(messages(store)[1]!.expired, undefined, "a browser cannot mark a message expired");
  store = send(store, "Permanent");
  assert.equal(messages(store)[2]!.expiresAt, undefined);
});

test("expired messages lose their text, keep their place, and the purge is journaled once", () => {
  let store = send(empty(), "Secret éphémère", { ttlSeconds: 60 });
  store = send(store, "Permanent", {}, later(1));
  const notYet = purgeExpiredMessages(store, later(59));
  assert.equal(notYet.count, 0);
  assert.equal(notYet.store, store);
  const purged = purgeExpiredMessages(store, later(61));
  assert.equal(purged.count, 1);
  const [gone, kept] = messages(purged.store);
  assert.equal(gone!.expired, true);
  assert.equal(gone!.body, "");
  assert.equal(gone!.id, messages(store)[0]!.id);
  assert.equal(kept!.body, "Permanent");
  assert.doesNotMatch(JSON.stringify(purged.store), /Secret éphémère/);
  const audit = purged.store.audit as Array<Record<string, unknown>>;
  assert.equal(audit[0]!.type, "itsm.messages.expired");
  assert.equal(audit[0]!.count, 1);
  assert.equal(verifyAuditChain(audit).status, "intact");
  assert.equal(purgeExpiredMessages(purged.store, later(120)).count, 0);
});

test("after a purge, the browser's refreshed copy saves normally", () => {
  let store = send(empty(), "Éphémère", { ttlSeconds: 30 });
  store = purgeExpiredMessages(store, later(31)).store;
  const saved = send(store, "Suite", {}, later(40));
  assert.deepEqual(messages(saved).map((m) => m.body), ["", "Suite"]);
});
