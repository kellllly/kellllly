/**
 * Step-up (Clerk reverification) for sensitive N1 actions. The API answers 403
 * with Clerk's reverification hint when the session was not verified in the
 * last 10 minutes. Clerk's `useReverification` opens its dialog only when the
 * wrapped call *returns* that hint, while our API client throws on 403:
 * `withStepUpHint` turns the thrown error back into the hint.
 */
type Hint = { clerk_error: { type: 'forbidden'; reason: 'reverification-error' } };

export function reverificationHintOf(error: unknown): Hint | null {
  const data = error && typeof error === 'object' && 'data' in error ? (error as { data: unknown }).data : null;
  if (!data || typeof data !== 'object') return null;
  const clerkError = (data as { clerk_error?: { type?: unknown; reason?: unknown } }).clerk_error;
  return clerkError?.type === 'forbidden' && clerkError.reason === 'reverification-error' ? data as Hint : null;
}

export function withStepUpHint<A extends unknown[], R>(call: (...args: A) => Promise<R>): (...args: A) => Promise<R | Hint> {
  return (...args: A) => call(...args).catch((error: unknown) => {
    const hint = reverificationHintOf(error);
    if (hint) return hint;
    throw error;
  });
}

export const isStepUpHint = (value: unknown): value is Hint =>
  Boolean(value && typeof value === 'object' && 'clerk_error' in value);

/** Message for a step-up that did not complete (cancelled dialog, no second factor). */
export function stepUpMessage(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error && (error as { code: unknown }).code === 'reverification_cancelled') {
    return 'Vérification d’identité annulée : l’action n’a pas été effectuée.';
  }
  const data = error && typeof error === 'object' && 'data' in error ? (error as { data: unknown }).data : null;
  if (data && typeof data === 'object' && (data as { code?: unknown }).code === 'second_factor_required') {
    return String((data as { error?: unknown }).error ?? 'Cette action exige une double authentification.');
  }
  return null;
}
