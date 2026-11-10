import { reverificationError } from "@clerk/shared/authorization-errors";

/**
 * Step-up authentication for sensitive N1 actions (role assignment, revocation,
 * attestation): the session must have been verified within the last 10 minutes
 * (Clerk reverification, `strict`). With ITSM_REQUIRE_SECOND_FACTOR=true the
 * account must also have signed in with a second factor (TOTP, passkey, SMS
 * code…) and both factors must be recent (`strict_mfa`).
 *
 * Without a second factor enrolled, Clerk's `strict` level accepts a recent first
 * factor: reverification alone does not enforce MFA, hence the separate option.
 * The 403 body carries Clerk's reverification hint, so `useReverification` in the
 * browser opens the verification dialog and retries the request.
 */
export type StepUpAuth = {
  factorVerificationAge?: [number, number] | null;
  has?: (params: { reverification: "strict" | "strict_mfa" }) => boolean;
};

export type StepUpOutcome =
  | { ok: true }
  | { ok: false; reason: "reverification" | "second_factor_missing"; body: Record<string, unknown> };

export function evaluateStepUp(auth: StepUpAuth | null | undefined, { requireSecondFactor }: { requireSecondFactor: boolean }): StepUpOutcome {
  const ages = auth?.factorVerificationAge;
  if (requireSecondFactor && (!Array.isArray(ages) || ages[1] === -1)) {
    return {
      ok: false,
      reason: "second_factor_missing",
      body: {
        code: "second_factor_required",
        error: "Cette action exige une double authentification. Activez un second facteur (application d’authentification ou clé de sécurité) dans votre compte, puis reconnectez-vous.",
      },
    };
  }
  const level = requireSecondFactor ? "strict_mfa" : "strict";
  let fresh = false;
  try {
    fresh = auth?.has?.({ reverification: level }) === true;
  } catch {
    fresh = false;
  }
  if (!fresh) {
    return {
      ok: false,
      reason: "reverification",
      body: { ...reverificationError(level), error: "Confirmez votre identité pour cette action sensible (vérification de moins de 10 minutes)." },
    };
  }
  return { ok: true };
}

export const requireSecondFactorFromEnv = (env: NodeJS.ProcessEnv = process.env) => env.ITSM_REQUIRE_SECOND_FACTOR === "true";
