import { isItsmRole, type ItsmRole } from "./itsm-rbac.ts";

export type ItsmDirectoryAccount = {
  userId: string;
  email: string | null;
  role: ItsmRole | null;
  serviceIds: string[];
};

type ClerkDirectoryUser = {
  id: string;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
  publicMetadata?: { itsmRole?: unknown; itsmServiceIds?: unknown };
};

export type ItsmDirectoryQuery = {
  q: string;
  limit: number;
  offset: number;
};

function parseInteger(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseItsmDirectoryQuery(
  q: unknown,
  limit: unknown,
  offset: unknown,
): ItsmDirectoryQuery | null {
  if (q !== undefined && (typeof q !== "string" || q.length > 120)) return null;
  const parsedLimit = parseInteger(limit, 10);
  const parsedOffset = parseInteger(offset, 0);
  if (parsedLimit === null || parsedLimit < 1 || parsedLimit > 50) return null;
  if (parsedOffset === null) return null;
  return { q: typeof q === "string" ? q.trim() : "", limit: parsedLimit, offset: parsedOffset };
}

export function toItsmDirectoryAccount(user: ClerkDirectoryUser): ItsmDirectoryAccount {
  const role = isItsmRole(user.publicMetadata?.itsmRole)
    ? user.publicMetadata.itsmRole
    : null;
  return {
    userId: user.id,
    email: user.primaryEmailAddress?.emailAddress ?? null,
    role,
    serviceIds: role && Array.isArray(user.publicMetadata?.itsmServiceIds)
      ? [...new Set(user.publicMetadata.itsmServiceIds.filter((id): id is string => typeof id === "string"))].sort()
      : [],
  };
}
