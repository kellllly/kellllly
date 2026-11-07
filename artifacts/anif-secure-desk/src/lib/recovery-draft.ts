export type Draft = { draftId?: string; base: unknown; local: unknown };

export function recoveryKey(userId: string): string {
  return `anif-sync-recovery-v1:${encodeURIComponent(userId)}`;
}

function sameDraft(left: Draft, right: Draft): boolean {
  if (left.draftId && right.draftId) return left.draftId === right.draftId;
  return JSON.stringify([left.base, left.local]) === JSON.stringify([right.base, right.local]);
}

function draftKey(key: string, draftId: string): string {
  return `${key}:draft:${encodeURIComponent(draftId)}`;
}

function parseDraft(raw: string | null): Draft | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const draft = value as Partial<Draft>;
    if (!('base' in draft) || !('local' in draft)
      || (draft.draftId !== undefined && typeof draft.draftId !== 'string')) return null;
    return draft as Draft;
  } catch {
    return null;
  }
}

export type RecoveryDraftReadResult = {
  drafts: Draft[];
  unreadableCount: number;
};

/** Reads both the legacy single-draft key and independently keyed drafts. */
export function readRecoveryDraftsWithStatus(storage: Storage, key: string): RecoveryDraftReadResult {
  const drafts: Draft[] = [];
  let unreadableCount = 0;
  const legacyRaw = storage.getItem(key);
  const legacy = parseDraft(legacyRaw);
  if (legacy) drafts.push(legacy);
  else if (legacyRaw !== null) unreadableCount += 1;

  const prefix = `${key}:draft:`;
  for (let index = 0; index < storage.length; index += 1) {
    const storedKey = storage.key(index);
    if (!storedKey?.startsWith(prefix)) continue;
    const raw = storage.getItem(storedKey);
    const draft = parseDraft(raw);
    if (draft && !drafts.some((item) => sameDraft(item, draft))) drafts.push(draft);
    else if (!draft && raw !== null) unreadableCount += 1;
  }
  return { drafts, unreadableCount };
}

export function readRecoveryDrafts(storage: Storage, key: string): Draft[] {
  return readRecoveryDraftsWithStatus(storage, key).drafts;
}

export function writeRecoveryDraft(storage: Storage, key: string, draft: Draft): boolean {
  try {
    if (!draft.draftId) {
      storage.setItem(key, JSON.stringify(draft));
    } else {
      storage.setItem(draftKey(key, draft.draftId), JSON.stringify(draft));
    }
    return true;
  } catch {
    return false;
  }
}

export function removeRecoveryDraft(storage: Storage, key: string, draft: Draft): boolean {
  try {
    const itemKey = draft.draftId ? draftKey(key, draft.draftId) : key;
    const stored = parseDraft(storage.getItem(itemKey));
    if (stored && !sameDraft(stored, draft)) return false;

    if (stored) storage.removeItem(itemKey);
    if (draft.draftId) {
      const legacy = parseDraft(storage.getItem(key));
      if (legacy && sameDraft(legacy, draft)) storage.removeItem(key);
    }

    return !readRecoveryDrafts(storage, key).some((item) => sameDraft(item, draft));
  } catch {
    return false;
  }
}

export function clearRecoveryDrafts(storage: Storage, key: string): boolean {
  try {
    const { drafts, unreadableCount } = readRecoveryDraftsWithStatus(storage, key);
    const removed = drafts.reduce(
      (success, draft) => removeRecoveryDraft(storage, key, draft) && success,
      true,
    );
    return removed && unreadableCount === 0 && readRecoveryDrafts(storage, key).length === 0;
  } catch {
    return false;
  }
}

/** Tracks the draft this tab actually read/wrote, not just an in-memory copy. */
export class RecoveryDraftGuard {
  private draft: Draft | null = null;
  private persisted = false;
  private key: string;
  private storage: () => Storage;
  constructor(key: string, storage: () => Storage) {
    this.key = key;
    this.storage = storage;
  }

  track(draft: Draft, persisted: boolean): void {
    this.draft = draft;
    this.persisted = persisted;
  }

  isCurrent(draft: Draft): boolean {
    if (this.draft !== draft) return false;
    if (!this.persisted) return true; // Explicitly reported, tab-only recovery.
    try {
      return readRecoveryDrafts(this.storage(), this.key).some((item) => sameDraft(item, draft));
    } catch {
      return false; // Never resend a persisted draft we can no longer verify.
    }
  }

  invalidate(): void {
    this.draft = null;
  }
}

export function watchRecoveryDraft(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  key: string,
  check: () => void,
): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === localStorage && (event.key === key || event.key?.startsWith(`${key}:draft:`) || event.key === null)) check();
  };
  target.addEventListener('storage', onStorage);
  target.addEventListener('focus', check);
  return () => {
    target.removeEventListener('storage', onStorage);
    target.removeEventListener('focus', check);
  };
}
