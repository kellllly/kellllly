import test from "node:test";
import assert from "node:assert/strict";
import { createActorCache } from "../src/lib/itsm-actor-cache.ts";

test("a burst of requests for one account costs a single Clerk lookup", async () => {
  let lookups = 0;
  const cache = createActorCache<string>(() => 0, 1000);
  const load = async () => { lookups += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return "N3"; };
  const roles = await Promise.all(Array.from({ length: 50 }, () => cache.get("user_a", load)));
  assert.deepEqual(new Set(roles), new Set(["N3"]));
  assert.equal(lookups, 1);
});

test("entries expire after the TTL", async () => {
  let clock = 0;
  let lookups = 0;
  const cache = createActorCache<number>(() => clock, 1000);
  const load = async () => ++lookups;
  assert.equal(await cache.get("user_a", load), 1);
  clock = 999;
  assert.equal(await cache.get("user_a", load), 1);
  clock = 1000;
  assert.equal(await cache.get("user_a", load), 2);
});

test("a role change invalidates the account at once, even during a lookup", async () => {
  let role = "N1";
  const cache = createActorCache<string>(() => 0, 60_000);
  assert.equal(await cache.get("user_a", async () => role), "N1");
  role = "N5";
  cache.invalidate("user_a");
  assert.equal(await cache.get("user_a", async () => role), "N5");

  let release!: () => void;
  const slow = cache.get("user_b", () => new Promise<string>((resolve) => { release = () => resolve("N1"); }));
  cache.invalidate("user_b");
  release();
  assert.equal(await slow, "N1");
  assert.equal(await cache.get("user_b", async () => "N5"), "N5", "the stale lookup must not be cached");
});

test("failed lookups are not cached", async () => {
  const cache = createActorCache<string>(() => 0, 60_000);
  await assert.rejects(cache.get("user_a", async () => { throw new Error("429"); }));
  assert.equal(await cache.get("user_a", async () => "N3"), "N3");
});
