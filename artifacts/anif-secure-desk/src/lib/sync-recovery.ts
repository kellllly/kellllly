type RecordValue = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordValue =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && equal(left[key], right[key]));
}

function keyedArray(value: unknown[]): value is RecordValue[] {
  const ids = value.map((item) => isRecord(item) && typeof item.id === 'string' ? item.id : null);
  return ids.every((id): id is string => id !== null) && new Set(ids).size === ids.length;
}

function relativeOrder(base: string[], candidate: string[]): string[] {
  const baseIds = new Set(base);
  return candidate.filter((id) => baseIds.has(id));
}

type MergeNode = { value?: unknown; conflicts: string[] };
export type ConflictChoices = Record<string, 'local' | 'remote'>;

export class RecoveryFlightGuard {
  private busy = false;

  get isBusy(): boolean {
    return this.busy;
  }

  acquire(): boolean {
    if (this.busy) return false;
    this.busy = true;
    return true;
  }

  release(): void {
    this.busy = false;
  }
}

export function choicesForRecoveryVersion(
  displayedVersion: number,
  choicesVersion: number,
  choices: ConflictChoices,
): ConflictChoices {
  return displayedVersion === choicesVersion ? choices : {};
}

type RecoverySnapshot = { store: Record<string, unknown>; version: number };
type RecoveryAttempt<T> =
  | { kind: 'invalidated' }
  | { kind: 'review'; latest: RecoverySnapshot; conflicts: string[]; staleChoices: boolean }
  | { kind: 'saved'; saved: RecoverySnapshot }
  | { kind: 'conflict'; latest: RecoverySnapshot }
  | { kind: 'failed'; error: unknown };

export async function confirmSharedRecovery<T>({
  choices,
  reviewedVersion,
  getLatest,
  save,
  merge,
  isCurrent,
  onLatest,
}: {
  choices?: ConflictChoices;
  reviewedVersion?: number;
  getLatest: () => Promise<RecoverySnapshot>;
  save: (value: T, version: number) => Promise<RecoverySnapshot>;
  merge: (latest: RecoverySnapshot, choices: ConflictChoices) => { value?: T; conflicts: string[] };
  isCurrent: () => boolean;
  onLatest?: (latest: RecoverySnapshot) => void;
}): Promise<RecoveryAttempt<T>> {
  let latest: RecoverySnapshot;
  try {
    latest = await getLatest();
  } catch (error) {
    return { kind: 'failed', error };
  }
  if (!isCurrent()) return { kind: 'invalidated' };
  onLatest?.(latest);

  const staleChoices = choices !== undefined && reviewedVersion !== latest.version;
  const merged = merge(latest, staleChoices ? {} : choices ?? {});
  if (choices === undefined || staleChoices || merged.conflicts.length || merged.value === undefined) {
    return { kind: 'review', latest, conflicts: merged.conflicts, staleChoices };
  }

  try {
    const saved = await save(merged.value, latest.version);
    if (!isCurrent()) return { kind: 'invalidated' };
    return { kind: 'saved', saved };
  } catch (error) {
    if (!isCurrent()) return { kind: 'invalidated' };
    const current = error && typeof error === 'object' && (error as { status?: unknown }).status === 409
      ? (error as { data?: { current?: unknown } }).data?.current
      : null;
    if (current && typeof current === 'object') {
      const snapshot = current as { store?: unknown; version?: unknown };
      if (snapshot.store && typeof snapshot.store === 'object' && typeof snapshot.version === 'number') {
        return { kind: 'conflict', latest: { store: snapshot.store as Record<string, unknown>, version: snapshot.version } };
      }
    }
    return { kind: 'failed', error };
  }
}

function valueAtPath(value: unknown, path: string): unknown {
  if (path === 'espace partagé') return value;
  if (path.endsWith('.$order')) {
    const items = valueAtPath(value, path.slice(0, -7));
    return Array.isArray(items) ? items.map((item) => item.id) : items;
  }
  let current = value;
  for (const part of path.split('.')) {
    if (Array.isArray(current)) current = current.find((item) =>
      Boolean(item && typeof item === 'object' && (item as { id?: unknown }).id === part));
    else if (current && typeof current === 'object') current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return current;
}

function mergeNode(base: unknown, local: unknown, remote: unknown, path: string, choices: ConflictChoices): MergeNode {
  if (equal(local, base)) return { value: remote, conflicts: [] };
  if (equal(remote, base) || equal(local, remote)) return { value: local, conflicts: [] };

  if (isRecord(base) && isRecord(local) && isRecord(remote)) {
    const result: RecordValue = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
    const conflicts: string[] = [];
    for (const key of keys) {
      const child = mergeNode(base[key], local[key], remote[key], path ? `${path}.${key}` : key, choices);
      conflicts.push(...child.conflicts);
      if (child.value !== undefined) result[key] = child.value;
    }
    return conflicts.length ? { conflicts } : { value: result, conflicts: [] };
  }

  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)
    && keyedArray(base) && keyedArray(local) && keyedArray(remote)) {
    const baseIds = base.map((item) => item.id as string);
    const localIds = local.map((item) => item.id as string);
    const remoteIds = remote.map((item) => item.id as string);
    const localOrder = relativeOrder(baseIds, localIds);
    const remoteOrder = relativeOrder(baseIds, remoteIds);
    const baseOrder = relativeOrder(baseIds, baseIds);
    const localReordered = !equal(localOrder, baseOrder.filter((id) => localIds.includes(id)));
    const remoteReordered = !equal(remoteOrder, baseOrder.filter((id) => remoteIds.includes(id)));
    const orderConflict = localReordered && remoteReordered && !equal(localOrder, remoteOrder);
    const orderPath = `${path}.$order`;

    const baseById = new Map(base.map((item) => [item.id as string, item]));
    const localById = new Map(local.map((item) => [item.id as string, item]));
    const remoteById = new Map(remote.map((item) => [item.id as string, item]));
    const mergedById = new Map<string, RecordValue>();
    const conflicts: string[] = orderConflict && !choices[orderPath] ? [orderPath] : [];
    const ids = new Set([...baseById.keys(), ...localById.keys(), ...remoteById.keys()]);
    for (const id of ids) {
      const child = mergeNode(baseById.get(id), localById.get(id), remoteById.get(id), path ? `${path}.${id}` : id, choices);
      conflicts.push(...child.conflicts);
      if (isRecord(child.value)) mergedById.set(id, child.value);
    }
    if (conflicts.length) return { conflicts };

    const preferredIds = orderConflict ? (choices[orderPath] === 'local' ? localIds : remoteIds)
      : localReordered ? localIds : remoteIds;
    const mergedIds = [
      ...preferredIds.filter((id) => mergedById.has(id)),
      ...[...mergedById.keys()].filter((id) => !preferredIds.includes(id)),
    ];
    return { value: mergedIds.map((id) => mergedById.get(id)!), conflicts: [] };
  }

  const conflictPath = path || 'espace partagé';
  if (choices[conflictPath] === 'local') return { value: local, conflicts: [] };
  if (choices[conflictPath] === 'remote') return { value: remote, conflicts: [] };
  return { conflicts: [conflictPath] };
}

export function mergeSharedChanges<T>(base: T, local: T, remote: T, choices: ConflictChoices = {}): { value?: T; conflicts: string[] } {
  return mergeNode(base, local, remote, '', choices) as { value?: T; conflicts: string[] };
}

/**
 * After a save succeeds, keep the edits made locally while it was in flight.
 * `sent` is what the save carried, `local` the current local data and `saved`
 * the server's canonical copy, which may rename new message IDs and stamp authors.
 * A collision with the server's normalization keeps the server's copy.
 */
export function rebaseAfterSave<T>(sent: T, local: T, saved: T): T {
  if (equal(sent, local)) return saved;
  const merged = mergeSharedChanges(sent, local, saved);
  return merged.conflicts.length || merged.value === undefined ? saved : merged.value;
}

export function conflictDetails(local: unknown, remote: unknown, paths: string[]) {
  const display = (value: unknown) => value === undefined ? 'Valeur supprimée (élément absent)' : JSON.stringify(value, null, 2);
  return paths.map((path) => ({
    path, local: display(valueAtPath(local, path)), remote: display(valueAtPath(remote, path)),
  }));
}

export function changedPaths(base: unknown, local: unknown, path = ''): string[] {
  if (equal(base, local)) return [];
  if (isRecord(base) && isRecord(local)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(local)]);
    return [...keys].flatMap((key) => changedPaths(base[key], local[key], path ? `${path}.${key}` : key));
  }
  if (Array.isArray(base) && Array.isArray(local) && keyedArray(base) && keyedArray(local)) {
    const baseById = new Map(base.map((item) => [item.id as string, item]));
    const localById = new Map(local.map((item) => [item.id as string, item]));
    const ids = new Set([...baseById.keys(), ...localById.keys()]);
    return [...ids].flatMap((id) => changedPaths(baseById.get(id), localById.get(id), path ? `${path}.${id}` : id));
  }
  return [path || 'espace partagé'];
}

export function recoveryEditDetails(
  local: unknown,
  paths: string[],
  describePath: (path: string) => string = (path) => path,
): { path: string; value: string }[] {
  return paths.slice(0, 20).map((path) => {
    const value = valueAtPath(local, path);
    return {
      path: describePath(path),
      value: value === undefined ? 'Valeur retirée dans la modification locale' : JSON.stringify(value, null, 2),
    };
  });
}

export function serverRefusalReason(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const message = (error as { data?: { error?: unknown } }).data?.error;
  return typeof message === 'string' && message.trim() ? message : null;
}
