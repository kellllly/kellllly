// The workspace identifies people by their Clerk user ID (authors, requesters,
// "my messages"). That ID is not meant to be read by people, so greetings and
// avatars use a readable name taken from the Clerk account instead.

export type NamedAccount = {
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
} | null | undefined;

export function displayNameFor(account: NamedAccount, fallback: string): string {
  const full = account?.fullName?.trim()
    || [account?.firstName, account?.lastName].map((part) => part?.trim()).filter(Boolean).join(' ');
  if (full) return full;
  const local = account?.primaryEmailAddress?.emailAddress?.split('@')[0]?.split('+')[0]?.trim();
  if (local) return local;
  return fallback;
}

export function firstNameFor(account: NamedAccount, fallback: string): string {
  return account?.firstName?.trim() || displayNameFor(account, fallback).split(/\s+/)[0];
}
