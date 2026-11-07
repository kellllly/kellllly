// Authors, requesters and audit actors are stored as Clerk user IDs. These
// helpers find those IDs in the workspace and swap them for readable names at
// display time; the stored data keeps the IDs.

const USER_ID = /\buser_[A-Za-z0-9]{6,64}\b/g;
export const PEOPLE_BATCH_SIZE = 100;

/** Every Clerk user ID found in any string of the value, sorted and unique. */
export function collectUserIds(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (typeof node === 'string') {
      for (const match of node.matchAll(USER_ID)) found.add(match[0]);
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return [...found].sort();
}

export function batches<T>(items: T[], size = PEOPLE_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Accounts used by the server itself in the journal. */
const SYSTEM_ACTORS: Readonly<Record<string, string>> = {
  'system:sla-monitor': 'Surveillance SLA (serveur)',
  'system:itsm-bootstrap': 'Initialisation (serveur)',
};

/** Replaces each known user ID inside the text; unknown IDs stay as they are. */
export function labelPeople(text: string | null | undefined, names: ReadonlyMap<string, string>): string {
  if (!text) return text ?? '';
  if (SYSTEM_ACTORS[text]) return SYSTEM_ACTORS[text];
  return text.replace(USER_ID, (id) => names.get(id) ?? id);
}
