import test from "node:test";
import assert from "node:assert/strict";
import {
  parseItsmDirectoryQuery,
  toItsmDirectoryAccount,
} from "../src/lib/itsm-user-directory.ts";

test("directory query accepts bounded search and pagination defaults", () => {
  assert.deepEqual(parseItsmDirectoryQuery(undefined, undefined, undefined), {
    q: "",
    limit: 10,
    offset: 0,
  });
  assert.deepEqual(parseItsmDirectoryQuery("  pilote@example.test ", "25", "50"), {
    q: "pilote@example.test",
    limit: 25,
    offset: 50,
  });
});

test("directory query rejects malformed values and out-of-range page sizes", () => {
  for (const params of [
    [[], undefined, undefined],
    ["x".repeat(121), undefined, undefined],
    ["", "0", undefined],
    ["", "51", undefined],
    ["", "10.5", undefined],
    ["", "1e2", undefined],
    ["", undefined, "-1"],
    ["", undefined, "1.5"],
  ] as const) {
    assert.equal(parseItsmDirectoryQuery(...params), null);
  }
});

test("directory projection exposes only account identity and current ITSM role", () => {
  const source = {
    id: "user_pilot_1",
    primaryEmailAddress: { emailAddress: "pilot@example.test" },
    publicMetadata: {
      itsmRole: "N3",
      itsmServiceIds: ["internal-service"],
      itsmBootstrapCompleted: true,
    },
    privateMetadata: { investigation: "must-not-leak" },
    unsafeTopLevelValue: "must-not-leak",
  };
  const projected = toItsmDirectoryAccount(source, new Set(["available-service"]));
  assert.deepEqual(projected, {
    userId: "user_pilot_1",
    email: "pilot@example.test",
    role: "N3",
    serviceIds: ["internal-service"],
    unavailableServiceIds: ["internal-service"],
  });
  assert.deepEqual(Object.keys(projected).sort(), ["email", "role", "serviceIds", "unavailableServiceIds", "userId"]);
  assert.doesNotMatch(JSON.stringify(projected), /must-not-leak/);
  assert.deepEqual(
    toItsmDirectoryAccount(source, new Set(["internal-service"])).unavailableServiceIds,
    [],
  );
});

test("directory projection labels missing email and invalid ITSM roles safely", () => {
  assert.deepEqual(toItsmDirectoryAccount({
    id: "user_without_email",
    primaryEmailAddress: null,
    publicMetadata: { itsmRole: "custom" },
  }, new Set()), {
    userId: "user_without_email",
    email: null,
    role: null,
    serviceIds: [],
    unavailableServiceIds: [],
  });
});
