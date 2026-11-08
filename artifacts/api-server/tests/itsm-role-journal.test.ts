import test from "node:test";
import assert from "node:assert/strict";
import { createRoleJournalCache, decideJournaledRole, latestRoleEvents } from "../src/lib/itsm-role-journal.ts";

const event = (userId: string, nextRole: string | null, at: string, serviceIds: string[] = [], type = "itsm.role.changed") =>
  ({ id: `${userId}-${at}`, type, targetUserId: userId, nextRole, serviceIds, at });

test("an account without a journal event gets no access, whatever Clerk says", () => {
  assert.deepEqual(decideJournaledRole({ role: "N1", serviceIds: [] }, undefined), { kind: "unjournaled" });
});

test("a role edited directly in Clerk does not apply: the journal role does, and the gap is flagged", () => {
  const latest = latestRoleEvents([event("user_a", "N2", "2026-11-01T10:00:00Z")]).get("user_a");
  assert.deepEqual(decideJournaledRole({ role: "N3", serviceIds: ["SVC-01"] }, latest),
    { kind: "granted", role: "N2", serviceIds: [], clerkDiffers: true });
  assert.deepEqual(decideJournaledRole({ role: "N2", serviceIds: [] }, latest),
    { kind: "granted", role: "N2", serviceIds: [], clerkDiffers: false });
});

test("a revocation in the journal wins over a role restored in Clerk", () => {
  const latest = latestRoleEvents([
    event("user_a", "N3", "2026-11-01T10:00:00Z"),
    event("user_a", null, "2026-11-02T10:00:00Z"),
  ]).get("user_a");
  assert.deepEqual(decideJournaledRole({ role: "N3", serviceIds: [] }, latest), { kind: "revoked" });
});

test("the latest role change or N1 attestation applies; other journal events are ignored", () => {
  const index = latestRoleEvents([
    event("user_a", "N2", "2026-11-01T10:00:00Z"),
    event("user_a", "N3", "2026-11-03T10:00:00Z", ["SVC-02", "SVC-01"], "itsm.role.attested"),
    { type: "itsm.ticket.converted", targetUserId: "user_a", nextRole: "N1", at: "2026-11-04T10:00:00Z" },
  ]);
  assert.deepEqual(decideJournaledRole({ role: "N3", serviceIds: ["SVC-01", "SVC-02"] }, index.get("user_a")),
    { kind: "granted", role: "N3", serviceIds: ["SVC-01", "SVC-02"], clerkDiffers: false });
});

test("the journal is read once per cache period and reread after invalidation", async () => {
  let loads = 0; let clock = 0;
  const cache = createRoleJournalCache(async () => { loads += 1; return [event("user_a", "N2", "2026-11-01T10:00:00Z")]; }, 5_000, () => clock);
  await Promise.all([cache.latest("user_a"), cache.latest("user_b")]);
  assert.equal((await cache.latest("user_a"))?.nextRole, "N2");
  assert.equal(loads, 1);
  clock = 6_000; await cache.latest("user_a");
  assert.equal(loads, 2);
  cache.invalidate(); await cache.latest("user_a");
  assert.equal(loads, 3);
});
