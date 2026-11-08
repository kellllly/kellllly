/**
 * The authorization journal is the source of truth for ITSM roles.
 *
 * Roles are mirrored in Clerk public metadata, but anyone holding the Clerk
 * secret key or a Clerk dashboard account can edit that metadata without going
 * through the application. The API therefore grants the role of the latest
 * journal event (role change or N1 attestation), never a Clerk-only value:
 * - no journal event for the account: no access until an N1 attests it;
 * - journal and Clerk differ: the journal role applies and the gap is reported;
 * - last journal event is a revocation: no access, whatever Clerk says.
 */

type JsonRecord = Record<string, unknown>;

export const ROLE_JOURNAL_TYPES = new Set(["itsm.role.changed", "itsm.role.attested"]);

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const normalizeIds = (ids: unknown) => [...new Set(
  Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [],
)].sort();

/** Latest role event per account (by timestamp), from the journal events. */
export function latestRoleEvents(events: unknown): Map<string, JsonRecord> {
  const latest = new Map<string, { event: JsonRecord; timestamp: number }>();
  for (const event of Array.isArray(events) ? events.filter(isRecord) : []) {
    if (!ROLE_JOURNAL_TYPES.has(String(event.type)) || typeof event.targetUserId !== "string") continue;
    const timestamp = typeof event.at === "string" ? Date.parse(event.at) : Number.NaN;
    const existing = latest.get(event.targetUserId);
    if (!existing || (Number.isFinite(timestamp) && (!Number.isFinite(existing.timestamp) || timestamp > existing.timestamp))) {
      latest.set(event.targetUserId, { event, timestamp });
    }
  }
  return new Map([...latest].map(([userId, { event }]) => [userId, event]));
}

export type RoleDecision =
  | { kind: "granted"; role: string; serviceIds: string[]; clerkDiffers: boolean }
  | { kind: "unjournaled" }
  | { kind: "revoked" };

/** Role to grant from the Clerk mirror and the latest journal event of the account. */
export function decideJournaledRole(
  clerk: { role: unknown; serviceIds: unknown },
  latest: JsonRecord | undefined,
): RoleDecision {
  if (!latest) return { kind: "unjournaled" };
  const role = typeof latest.nextRole === "string" && latest.nextRole ? latest.nextRole : null;
  if (!role) return { kind: "revoked" };
  const serviceIds = normalizeIds(latest.serviceIds);
  const clerkDiffers = clerk.role !== role
    || JSON.stringify(normalizeIds(clerk.serviceIds)) !== JSON.stringify(serviceIds);
  return { kind: "granted", role, serviceIds, clerkDiffers };
}

/**
 * Short cache of the journal's role events, so each request does not read the
 * whole workspace. Role changes made by the API call `invalidate()`.
 */
export function createRoleJournalCache(load: () => Promise<unknown>, ttlMs = 5_000, now: () => number = Date.now) {
  let cached: { index: Map<string, JsonRecord>; expiresAt: number } | null = null;
  let pending: Promise<Map<string, JsonRecord>> | null = null;
  return {
    async latest(userId: string): Promise<JsonRecord | undefined> {
      if (!cached || cached.expiresAt <= now()) {
        pending ??= load().then((events) => {
          const index = latestRoleEvents(events);
          cached = { index, expiresAt: now() + ttlMs };
          return index;
        }).finally(() => { pending = null; });
        return (await pending).get(userId);
      }
      return cached.index.get(userId);
    },
    invalidate() { cached = null; },
  };
}
