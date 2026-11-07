import test from "node:test";
import assert from "node:assert/strict";
import {
  createPeopleDirectory,
  MAX_PEOPLE_PER_REQUEST,
  parsePeopleIds,
  personFromClerkUser,
} from "../src/lib/itsm-people.ts";

test("only well-formed Clerk user IDs are accepted, deduplicated", () => {
  assert.deepEqual(parsePeopleIds("user_abc, user_def,user_abc"), ["user_abc", "user_def"]);
  assert.equal(parsePeopleIds("user_abc,Olivier Nguema"), null);
  assert.equal(parsePeopleIds("user_abc,../etc"), null);
  assert.equal(parsePeopleIds(""), null);
  assert.equal(parsePeopleIds(["user_abc"]), null);
  const tooMany = Array.from({ length: MAX_PEOPLE_PER_REQUEST + 1 }, (_, i) => `user_${i}`).join(",");
  assert.equal(parsePeopleIds(tooMany), null);
});

test("a person carries a name only, never the e-mail", () => {
  assert.deepEqual(personFromClerkUser({ id: "user_1", firstName: "Awa", lastName: "Mba" }), { userId: "user_1", name: "Awa Mba" });
  const unnamed = personFromClerkUser({ id: "user_3LmUjSSM4ppKElAX", firstName: null, lastName: null });
  assert.equal(unnamed.name, "Compte pKElAX");
  assert.equal(Object.keys(unnamed).sort().join(","), "name,userId");
});

test("names are cached and unknown accounts get a neutral label", async () => {
  let calls = 0;
  let clock = 0;
  const resolve = createPeopleDirectory(async (ids) => {
    calls += 1;
    return ids.filter((id) => id === "user_known").map((id) => ({ id, fullName: "Awa Mba" }));
  }, () => clock, 1000);

  assert.deepEqual(await resolve(["user_known", "user_gone"]), [
    { userId: "user_known", name: "Awa Mba" },
    { userId: "user_gone", name: "Compte r_gone" },
  ]);
  await resolve(["user_known"]);
  assert.equal(calls, 1);
  clock = 1001;
  await resolve(["user_known"]);
  assert.equal(calls, 2);
});
