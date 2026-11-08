// Readable names for the Clerk IDs stored as authors, requesters and audit
// actors. Every role that can read the workspace may resolve them, so the
// directory returns a display name only: no e-mail, role or service scope.

export const MAX_PEOPLE_PER_REQUEST = 100;
export const PEOPLE_CACHE_TTL_MS = 5 * 60_000;

const CLERK_USER_ID = /^user_[A-Za-z0-9]{1,64}$/u;

export type ItsmPerson = { userId: string; name: string };

export type ClerkNamedUser = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
};

/** Parses `ids=a,b,c`; returns null when the list is malformed or too long. */
export function parsePeopleIds(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  const ids = [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_PEOPLE_PER_REQUEST) return null;
  return ids.every((id) => CLERK_USER_ID.test(id)) ? ids : null;
}

/** Neutral label for an account without a name; never derived from the e-mail. */
export function unnamedAccountLabel(userId: string): string {
  return `Compte ${userId.slice(-6)}`;
}

export function personFromClerkUser(user: ClerkNamedUser): ItsmPerson {
  const name = user.fullName?.trim()
    || [user.firstName, user.lastName].map((part) => part?.trim()).filter(Boolean).join(" ");
  return { userId: user.id, name: name || unnamedAccountLabel(user.id) };
}

/**
 * Resolves names through Clerk with a short in-memory cache, so a page full
 * of messages does not turn into one Clerk call per author on every load.
 * Unknown IDs (deleted accounts) are cached too and get the neutral label.
 */
export function createPeopleDirectory(
  fetchUsers: (ids: string[]) => Promise<ClerkNamedUser[]>,
  now: () => number = Date.now,
  ttlMs = PEOPLE_CACHE_TTL_MS,
) {
  const cache = new Map<string, { person: ItsmPerson; expiresAt: number }>();
  return async function resolve(ids: string[]): Promise<ItsmPerson[]> {
    const at = now();
    const missing = ids.filter((id) => (cache.get(id)?.expiresAt ?? 0) <= at);
    if (missing.length > 0) {
      const found = new Map((await fetchUsers(missing)).map((user) => [user.id, personFromClerkUser(user)]));
      for (const id of missing) {
        cache.set(id, {
          person: found.get(id) ?? { userId: id, name: unnamedAccountLabel(id) },
          expiresAt: at + ttlMs,
        });
      }
    }
    return ids.map((id) => cache.get(id)!.person);
  };
}

export const MAX_CONTACT_RESULTS = 20;
export const CONTACT_SEARCH_MAX_LENGTH = 80;
const CONTACT_ROLES = new Set(["N1", "N2", "N3"]);

export type ItsmContact = ItsmPerson & { role: "N1" | "N2" | "N3" };
type ClerkContactUser = ClerkNamedUser & { publicMetadata?: { itsmRole?: unknown } | null };

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Colleagues who can join a bilateral channel: other N1–N3 accounts, matched
 * on their name only. Searching on e-mail addresses would let any agent test
 * whether an address has an account, so it is not offered.
 */
export function contactsFromClerkUsers(users: readonly ClerkContactUser[], actorId: string, query: string): ItsmContact[] {
  const terms = fold(query.trim()).split(/\s+/u).filter(Boolean);
  const contacts: ItsmContact[] = [];
  for (const user of users) {
    const role = user.publicMetadata?.itsmRole;
    if (user.id === actorId || typeof role !== "string" || !CONTACT_ROLES.has(role)) continue;
    const person = personFromClerkUser(user);
    if (person.name === unnamedAccountLabel(user.id)) continue;
    const name = fold(person.name);
    if (terms.every((term) => name.includes(term))) contacts.push({ ...person, role: role as ItsmContact["role"] });
  }
  return contacts.sort((left, right) => left.name.localeCompare(right.name, "fr")).slice(0, MAX_CONTACT_RESULTS);
}
