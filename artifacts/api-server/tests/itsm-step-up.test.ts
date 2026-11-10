import test from "node:test";
import assert from "node:assert/strict";
import { isReverificationHint } from "@clerk/shared/authorization-errors";
import { evaluateStepUp } from "../src/lib/itsm-step-up.ts";

/** Clerk's own rule for `has({ reverification })`, reproduced for the levels used here. */
const auth = (ages: [number, number] | null) => ({
  factorVerificationAge: ages,
  has: ({ reverification }: { reverification: "strict" | "strict_mfa" }) => {
    if (!ages) return false;
    const [first, second] = ages;
    const fresh = (age: number) => age !== -1 && age < 10;
    if (reverification === "strict") return second === -1 ? fresh(first) : fresh(second);
    return second === -1 ? fresh(first) : fresh(first) && fresh(second);
  },
});

test("a recent verification passes; an old one asks the browser to reverify", () => {
  assert.deepEqual(evaluateStepUp(auth([2, -1]), { requireSecondFactor: false }), { ok: true });
  const old = evaluateStepUp(auth([45, -1]), { requireSecondFactor: false });
  assert.equal(old.ok, false);
  assert.ok(!old.ok && old.reason === "reverification" && isReverificationHint(old.body), "the body is Clerk's reverification hint");
  assert.match(String(!old.ok && old.body.error), /Confirmez votre identité/u);
});

test("with ITSM_REQUIRE_SECOND_FACTOR, an account without a second factor is refused even when recent", () => {
  const refused = evaluateStepUp(auth([1, -1]), { requireSecondFactor: true });
  assert.ok(!refused.ok && refused.reason === "second_factor_missing");
  assert.equal(!refused.ok && refused.body.code, "second_factor_required");
  assert.equal(isReverificationHint(!refused.ok && refused.body), false, "no dialog: the user must enrol a factor first");
  assert.deepEqual(evaluateStepUp(auth([3, 3]), { requireSecondFactor: true }), { ok: true });
  const stale = evaluateStepUp(auth([3, 40]), { requireSecondFactor: true });
  assert.ok(!stale.ok && stale.reason === "reverification");
});

test("a missing or failing session check fails closed", () => {
  assert.equal(evaluateStepUp(null, { requireSecondFactor: false }).ok, false);
  assert.equal(evaluateStepUp({ factorVerificationAge: [1, -1], has: () => { throw new Error("no session"); } }, { requireSecondFactor: false }).ok, false);
});
