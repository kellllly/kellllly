// Every API request needs the caller's ITSM role, which lives in Clerk user
// metadata. Reading it from Clerk on each request hits Clerk's rate limit
// (HTTP 429) as soon as a few tabs poll the workspace, and the API then
// answers 503. This cache keeps each account for a few seconds and shares one
// lookup between concurrent requests. Role administration still reads Clerk
// directly, and every role change made by this server invalidates the entry.

export const ACTOR_CACHE_TTL_MS = 10_000;

export function createActorCache<T>(now: () => number = Date.now, ttlMs = ACTOR_CACHE_TTL_MS) {
  const entries = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, Promise<T>>();
  let generation = 0;

  return {
    async get(userId: string, load: () => Promise<T>): Promise<T> {
      const cached = entries.get(userId);
      if (cached && cached.expiresAt > now()) return cached.value;
      const pending = inFlight.get(userId);
      if (pending) return pending;
      const startedAt = generation;
      const request = load().then((value) => {
        // A role change during the lookup makes this result stale: do not keep it.
        if (startedAt === generation) entries.set(userId, { value, expiresAt: now() + ttlMs });
        return value;
      }).finally(() => inFlight.delete(userId));
      inFlight.set(userId, request);
      return request;
    },
    invalidate(userId: string): void {
      generation += 1;
      entries.delete(userId);
      inFlight.delete(userId);
    },
  };
}
