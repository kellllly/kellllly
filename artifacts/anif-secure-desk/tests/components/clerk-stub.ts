/**
 * Stand-in for @clerk/react in screen tests. useReverification behaves like
 * Clerk's: when the wrapped call returns the reverification hint, the dialog
 * "opens"; `clerk.reverify` decides whether it succeeds (the call is retried)
 * or is cancelled (Clerk throws reverification_cancelled).
 */
export const clerk = {
  user: { id: 'user_n1', fullName: 'Awa N1', primaryEmailAddress: { emailAddress: 'n1@example.test' } } as Record<string, unknown> | null,
  reverify: 'success' as 'success' | 'cancel',
  dialogs: 0,
};
const isHint = (value: unknown) => Boolean(value && typeof value === 'object' && 'clerk_error' in value);
export const useClerk = () => ({ signOut: async () => undefined });
export const useUser = () => ({ user: clerk.user, isLoaded: true, isSignedIn: Boolean(clerk.user) });
export function useReverification<A extends unknown[], R>(call: (...args: A) => Promise<R>) {
  return async (...args: A) => {
    const first = await call(...args);
    if (!isHint(first)) return first;
    clerk.dialogs += 1;
    if (clerk.reverify === 'cancel') throw Object.assign(new Error('cancelled'), { code: 'reverification_cancelled' });
    return call(...args);
  };
}
