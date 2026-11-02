type Draft = { draftId?: string; base: unknown; local: unknown };

export function recoveryKey(userId: string): string {
  return `anif-sync-recovery-v1:${encodeURIComponent(userId)}`;
}

function identity(draft: Draft): string {
  // Legacy drafts have no ID. Remote/version change during comparison, not identity.
  return draft.draftId ?? JSON.stringify([draft.base, draft.local]);
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
      const raw = this.storage().getItem(this.key);
      return raw !== null && identity(JSON.parse(raw)) === identity(draft);
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
    if (event.storageArea === localStorage && (event.key === key || event.key === null)) check();
  };
  target.addEventListener('storage', onStorage);
  target.addEventListener('focus', check);
  return () => {
    target.removeEventListener('storage', onStorage);
    target.removeEventListener('focus', check);
  };
}
