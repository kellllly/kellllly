import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useClerk, useUser } from '@clerk/react';
import { getItsmWorkspace, importItsmExamples, saveItsmWorkspace } from '@workspace/api-client-react';
import { migrate } from './seed';
import { readDemoStore, type StorageIssue } from './storage';
import {
  readRecoveryDraftsWithStatus, RecoveryDraftGuard,
  recoveryKey, removeRecoveryDraft, watchRecoveryDraft, writeRecoveryDraft as writeStoredRecoveryDraft,
} from './recovery-draft';
import {
  changedPaths, confirmSharedRecovery, conflictDetails, mergeSharedChanges, RecoveryFlightGuard,
  recoveryEditDetails, serverRefusalReason, type ConflictChoices,
} from './sync-recovery';
import type { Store } from './types';

export { STORAGE_KEY } from './storage';

type SharedData = Pick<Store, 'tickets' | 'conversations' | 'services' | 'assets' | 'audit' | 'kedb' | 'notifications' | 'seeded' | 'schema'>;
type Ctx = {
  store: Store;
  setStore: Dispatch<SetStateAction<Store>>;
  log: (action: string, scope: string) => void;
  storageIssue: StorageIssue;
  dismissIssue: () => void;
  unreadableRecoveryDraftCount: number;
  recovery: SyncRecovery | null;
  recoveryDrafts: { draftId: string; changed: string[]; summary: string }[];
  selectRecoveryDraft: (draftId: string) => void;
  resumeConflict: (choices?: ConflictChoices, reviewedVersion?: number) => Promise<void>;
  acceptRemoteSnapshot: () => void;
};
type SyncRecovery = {
  draftId: string;
  changed: string[];
  collisions: string[];
  fields: { path: string; label: string; local: string; remote: string }[];
  localEdits: { path: string; value: string }[];
  remoteVersion: number;
  busy: boolean;
};
type PendingConflict = {
  draftId?: string;
  base: SharedData;
  local: SharedData;
  remote: Record<string, unknown>;
  version: number;
};
const StoreContext = createContext<Ctx | null>(null);
const localThemeKey = 'anif-theme-v1';
const sharedArrayFields = ['tickets', 'conversations', 'services', 'assets', 'audit', 'kedb', 'notifications', 'seeded'] as const;
const sectionLabels: Record<string, string> = {
  tickets: 'Tickets',
  conversations: 'Messagerie',
  services: 'Services',
  assets: 'Parc matériel',
  audit: 'Journal',
  kedb: 'Base de connaissances',
  notifications: 'Notifications',
  seeded: 'Exemples',
};

function isSharedData(value: unknown): value is SharedData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return data.schema === 2 && sharedArrayFields.every((field) => Array.isArray(data[field]));
}

function isPendingConflict(value: unknown): value is PendingConflict {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as Partial<PendingConflict>;
  return isSharedData(draft.base) && isSharedData(draft.local)
    && (draft.draftId === undefined || typeof draft.draftId === 'string')
    && Boolean(draft.remote) && typeof draft.remote === 'object' && !Array.isArray(draft.remote)
    && typeof draft.version === 'number' && Number.isFinite(draft.version);
}

function readRecoveryDrafts(userId: string): { drafts: PendingConflict[]; unreadableCount: number } {
  const key = recoveryKey(userId);
  const result = readRecoveryDraftsWithStatus(localStorage, key);
  const valid = result.drafts.filter(isPendingConflict);
  const drafts = valid.map((draft) => {
    if (draft.draftId) return draft;
    const migrated = { ...draft, draftId: crypto.randomUUID() };
    if (writeStoredRecoveryDraft(localStorage, key, migrated)) removeRecoveryDraft(localStorage, key, draft);
    return migrated;
  });
  return { drafts, unreadableCount: result.unreadableCount + result.drafts.length - valid.length };
}

function writeRecoveryDraft(userId: string, pending: PendingConflict): boolean {
  return writeStoredRecoveryDraft(localStorage, recoveryKey(userId), pending);
}

export function clearSyncRecoveryDraft(userId: string): boolean {
  try {
    const { drafts } = readRecoveryDrafts(userId);
    return drafts.reduce(
      (cleared, draft) => removeRecoveryDraft(localStorage, recoveryKey(userId), draft) && cleared,
      true,
    );
  } catch { return false; }
}

const fieldLabels: Record<string, string> = {
  title: 'sujet',
  status: 'statut',
  description: 'description',
  assignee: 'assignation',
  impact: 'impact',
  urgency: 'urgence',
  messages: 'messages',
  $order: 'ordre des éléments',
};

function readLocalTheme(): 'light' | 'dark' | null {
  try {
    const theme = localStorage.getItem(localThemeKey);
    return theme === 'dark' || theme === 'light' ? theme : null;
  } catch {
    return null;
  }
}

function sharedData(store: Store): SharedData {
  return {
    schema: store.schema,
    tickets: store.tickets,
    conversations: store.conversations,
    services: store.services,
    assets: store.assets,
    audit: store.audit,
    kedb: store.kedb,
    notifications: store.notifications,
    seeded: store.seeded,
  };
}

function applySnapshot(previous: Store, remote: Record<string, unknown>): Store {
  const next = migrate(remote);
  return {
    ...next,
    profile: next.profile,
    theme: previous.theme,
    drafts: previous.drafts,
    notifRead: previous.notifRead,
  };
}

function snapshotFromError(error: unknown): { store: Record<string, unknown>; version: number } | null {
  if (!error || typeof error !== 'object' || (error as { status?: unknown }).status !== 409) return null;
  const current = (error as { data?: { current?: unknown } }).data?.current;
  if (!current || typeof current !== 'object') return null;
  const { store: remoteStore, version: remoteVersion } = current as { store?: unknown; version?: unknown };
  if (!remoteStore || typeof remoteStore !== 'object' || typeof remoteVersion !== 'number') return null;
  return { store: remoteStore as Record<string, unknown>, version: remoteVersion };
}

function isVersionConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { status?: unknown }).status === 409);
}

function formatChangedPaths(paths: string[]): string[] {
  return paths.slice(0, 5).map((path) => {
    const [section, ...parts] = path.split('.');
    const description = parts.map((part) => fieldLabels[part] ?? part).join(' · ');
    return description ? `${sectionLabels[section] ?? section} · ${description}` : sectionLabels[section] ?? section;
  });
}

function localEditDetails(local: SharedData, paths: string[]) {
  return recoveryEditDetails(local, paths, (path) => formatChangedPaths([path])[0] ?? path);
}

function recoveryFields(local: SharedData, remote: SharedData, paths: string[]) {
  return conflictDetails(local, remote, paths).map((field) => ({
    ...field, label: formatChangedPaths([field.path])[0] ?? field.path,
  }));
}

function changedSectionNames(paths: string[]): string {
  const sections = [...new Set(paths.map((path) => path.split('.')[0]))]
    .map((section) => sectionLabels[section] ?? section);
  return sections.length ? sections.join(', ') : 'espace partagé';
}

function SyncPanel({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const missingRole = error.includes('Aucun rôle ITSM');
  const accountLabel = user?.primaryEmailAddress?.emailAddress ?? user?.username ?? user?.id;

  async function changeAccount() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut({ redirectUrl: import.meta.env.BASE_URL });
    } catch {
      setSigningOut(false);
      setSignOutError('La déconnexion a échoué. Réessayez pour changer de compte.');
    }
  }

  return <main className="grid min-h-[100dvh] place-items-center bg-background p-6">
    <section role="alert" className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="eyebrow">ESPACE ITSM PARTAGÉ · PILOTE FICTIF</div>
      <h1 className="mt-2 text-xl font-semibold">{missingRole ? 'Compte sans habilitation ITSM' : 'Synchronisation indisponible'}</h1>
      {accountLabel && <p data-testid="text-sync-account" className="mt-3 break-all text-sm font-medium">Compte connecté : {accountLabel}</p>}
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{error}</p>
      {missingRole && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Utilisez un compte déjà habilité ou demandez une attribution à un administrateur N1. Créer un compte ne lui attribue pas automatiquement de rôle.</p>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button onClick={onRetry} disabled={signingOut} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Réessayer</button>
        <button data-testid="button-change-sync-account" onClick={() => void changeAccount()} disabled={signingOut} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-50">{signingOut ? 'Déconnexion…' : 'Changer de compte'}</button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Changer de compte vous déconnecte et vous ramène à l’accueil pour vous reconnecter.</p>
      {signOutError && <p role="status" className="mt-3 text-sm text-destructive">{signOutError}</p>}
    </section>
  </main>;
}

export function StoreProvider({ children, userId }: { children: ReactNode; userId: string }) {
  const local = useRef<ReturnType<typeof readDemoStore> | null>(null);
  if (!local.current) local.current = readDemoStore();
  const [store, setLocalStore] = useState<Store>(() => {
    const theme = readLocalTheme();
    return theme ? { ...local.current!.store, theme } : local.current!.store;
  });
  const storeRef = useRef(store);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [storageIssue, setIssue] = useState<StorageIssue>(local.current.issue);
  const [unreadableRecoveryDraftCount, setUnreadableRecoveryDraftCount] = useState(0);
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  const lastSynced = useRef(sharedData(store));
  const pendingConflict = useRef<PendingConflict | null>(null);
  const pendingConflicts = useRef<PendingConflict[]>([]);
  const [recovery, setRecovery] = useState<SyncRecovery | null>(null);
  const [recoveryDrafts, setRecoveryDrafts] = useState<{ draftId: string; changed: string[]; summary: string }[]>([]);
  const writeQueue = useRef(Promise.resolve());
  const writeBlocked = useRef(false);
  const pendingWrites = useRef(0);
  const recoveryFlight = useRef<RecoveryFlightGuard | null>(null);
  recoveryFlight.current ??= new RecoveryFlightGuard();
  const draftGuard = useRef(new RecoveryDraftGuard(recoveryKey(userId), () => localStorage));

  const updateRecoveryDraftList = useCallback((drafts: PendingConflict[]) => {
    pendingConflicts.current = drafts;
    setRecoveryDrafts(drafts.map((draft) => {
      const changed = changedPaths(draft.base, draft.local);
      const firstEdit = localEditDetails(draft.local, changed)[0];
      return {
        draftId: draft.draftId!,
        changed: formatChangedPaths(changed),
        summary: firstEdit ? `${firstEdit.path} : ${firstEdit.value.slice(0, 100)}` : 'Aucun détail disponible',
      };
    }));
  }, []);

  const activateRecoveryDraft = useCallback((pending: PendingConflict, persisted = true) => {
    pendingConflict.current = pending;
    draftGuard.current.track(pending, persisted);
    writeBlocked.current = true;
    const changed = changedPaths(pending.base, pending.local);
    const remote = sharedData(applySnapshot(storeRef.current, pending.remote));
    const collisions = mergeSharedChanges(pending.base, pending.local, remote).conflicts;
    setRecovery({
      draftId: pending.draftId!,
      changed: formatChangedPaths(changed),
      collisions: formatChangedPaths(collisions),
      fields: recoveryFields(pending.local, remote, collisions),
      localEdits: localEditDetails(pending.local, changed),
      remoteVersion: pending.version,
      busy: false,
    });
    setIssue({
      kind: 'save',
      message: 'Une modification refusée, conservée pour ce compte, a été retrouvée. Elle n’a pas été renvoyée. Reprenez-la explicitement ou abandonnez-la.',
    });
  }, []);

  const selectRecoveryDraft = useCallback((draftId: string) => {
    const pending = pendingConflicts.current.find((draft) => draft.draftId === draftId);
    if (pending) activateRecoveryDraft(pending);
  }, [activateRecoveryDraft]);

  const invalidateRecovery = useCallback(() => {
    draftGuard.current.invalidate();
    pendingConflict.current = null;
    setRecovery(null);
    // Keep writes blocked until the canonical snapshot has been fetched.
    writeBlocked.current = true;
    setIssue({
      kind: 'save',
      message: 'Cette modification a été abandonnée, reprise ou remplacée dans un autre onglet. Sa reprise est bloquée. L’état partagé va être rechargé.',
    });
    setRetry((value) => value + 1);
  }, []);

  const isCurrentRecovery = useCallback((pending: PendingConflict) => {
    if (pendingConflict.current === pending && draftGuard.current.isCurrent(pending)) return true;
    if (pendingConflict.current === pending) invalidateRecovery();
    return false;
  }, [invalidateRecovery]);

  useEffect(() => watchRecoveryDraft(window, recoveryKey(userId), () => {
    const pending = pendingConflict.current;
    if (pending) isCurrentRecovery(pending);
    try {
      const readResult = readRecoveryDrafts(userId);
      setUnreadableRecoveryDraftCount(readResult.unreadableCount);
      const persisted = readResult.drafts;
      const known = new Map(pendingConflicts.current.map((draft) => [draft.draftId, draft]));
      updateRecoveryDraftList(persisted.map((draft) => ({
        ...draft,
        remote: known.get(draft.draftId!)?.remote ?? draft.remote,
        version: known.get(draft.draftId!)?.version ?? draft.version,
      })));
    } catch { /* Keep the visible options if local storage is unavailable. */ }
  }), [userId, isCurrentRecovery, updateRecoveryDraftList]);

  const hydrate = useCallback(async () => {
    setStatus('loading');
    writeBlocked.current = false;
    try {
      const source = local.current!;
      const readResult = readRecoveryDrafts(userId);
      setUnreadableRecoveryDraftCount(readResult.unreadableCount);
      const savedDrafts = readResult.drafts;
      if (savedDrafts[0]) draftGuard.current.track(savedDrafts[0], true);
      const current = await getItsmWorkspace();
      const currentClearance = (current.store.profile as { clearance?: unknown } | undefined)?.clearance;
      const role = typeof currentClearance === 'string' ? currentClearance.slice(0, 2) : '';
      let imported = current;
      if (!savedDrafts.length && ['N1', 'N2', 'N3'].includes(role)) {
        imported = await importItsmExamples({ store: sharedData(source.store) });
      }
      if (current.version > imported.version) imported = await getItsmWorkspace();
      version.current = imported.version;
      const hydrated = applySnapshot(storeRef.current, imported.store);
      storeRef.current = hydrated;
      lastSynced.current = sharedData(hydrated);
      setLocalStore(hydrated);
      if (savedDrafts.length > 0) {
        const pending = savedDrafts.map((draft) => ({
          ...draft, remote: imported.store, version: imported.version,
        }));
        updateRecoveryDraftList(pending);
        if (pending[0] && draftGuard.current.isCurrent(savedDrafts[0])) {
          activateRecoveryDraft(pending[0]);
        }
      }
      setStatus('ready');
      if (source.issue?.kind === 'load') {
        setIssue({
          kind: 'load',
          message: 'Les exemples locaux illisibles ont été laissés intacts et ne seront pas importés. Les données partagées restent disponibles.',
        });
      }
      const theme = readLocalTheme();
      if (theme) {
        const themed = { ...storeRef.current, theme };
        storeRef.current = themed;
        setLocalStore(themed);
      }
    } catch (error) {
      setStatus('error');
      setIssue({
        kind: 'load',
        message: error instanceof Error
          ? `${error.message} Les modifications ne sont pas enregistrées localement.`
          : 'Impossible de charger les données partagées.',
      });
    }
  }, [userId, updateRecoveryDraftList, activateRecoveryDraft]);

  useEffect(() => { void hydrate(); }, [hydrate, retry]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', store.theme === 'dark');
    try { localStorage.setItem(localThemeKey, store.theme); } catch { /* optional local preference */ }
  }, [store.theme]);

  const setStore = useCallback<Dispatch<SetStateAction<Store>>>((action) => {
    const previous = storeRef.current;
    const next = typeof action === 'function' ? action(previous) : action;
    const sharedChanged = JSON.stringify(sharedData(previous)) !== JSON.stringify(sharedData(next));
    if (writeBlocked.current && sharedChanged) return;
    storeRef.current = next;
    setLocalStore(next);
    const before = JSON.stringify(sharedData(previous));
    const after = JSON.stringify(sharedData(next));
    if (status === 'ready' && before !== after) {
      const captured = sharedData(next);
      pendingWrites.current += 1;
      writeQueue.current = writeQueue.current.then(async () => {
        if (writeBlocked.current) return;
        try {
          const saved = await saveItsmWorkspace({ store: captured, version: version.current });
          version.current = saved.version;
          const canonical = applySnapshot(storeRef.current, saved.store);
          storeRef.current = canonical;
          lastSynced.current = sharedData(canonical);
          setLocalStore(canonical);
        } catch (error) {
          writeBlocked.current = true;
          const base = lastSynced.current;
          const localChanges = sharedData(storeRef.current);
          const changed = changedPaths(base, localChanges);
          if (!isVersionConflict(error)) {
            setIssue({
              kind: 'save',
              message: error instanceof Error
                ? `${error.message} L’enregistrement est suspendu ; les changements non confirmés restent visibles dans cet onglet.`
                : 'L’enregistrement a échoué. Les changements non confirmés restent visibles dans cet onglet.',
            });
            try {
              const latest = await getItsmWorkspace();
              version.current = latest.version;
              const canonical = applySnapshot(storeRef.current, latest.store);
              storeRef.current = canonical;
              lastSynced.current = sharedData(canonical);
              setLocalStore(canonical);
            } catch { /* Preserve the visible local changes and explicit save error. */ }
            return;
          }
          let latest = snapshotFromError(error);
          try {
            latest ??= await getItsmWorkspace();
          } catch {
            const pending = {
              draftId: crypto.randomUUID(),
              base,
              local: localChanges,
              remote: lastSynced.current as Record<string, unknown>,
              version: version.current,
            };
            pendingConflict.current = pending;
            const persisted = writeRecoveryDraft(userId, pending);
            updateRecoveryDraftList([
              ...pendingConflicts.current.filter((draft) => draft.draftId !== pending.draftId),
              pending,
            ]);
            activateRecoveryDraft(pending, persisted);
            setIssue({
              kind: 'save',
              message: error instanceof Error
                ? `${error.message} L’état distant n’a pas pu être chargé. Votre modification ${persisted ? 'est conservée pour ce compte et ne sera renvoyée que sur demande' : 'reste uniquement dans cet onglet, car le stockage local est indisponible'}.`
                : `Échec de l’enregistrement partagé. Votre modification ${persisted ? 'est conservée pour ce compte' : 'reste uniquement dans cet onglet, car le stockage local est indisponible'}.`,
            });
            return;
          }
          version.current = latest.version;
          const collisions = mergeSharedChanges(
            base,
            localChanges,
            sharedData(applySnapshot(storeRef.current, latest.store)),
          ).conflicts;
          const pending = { draftId: crypto.randomUUID(), base, local: localChanges, remote: latest.store, version: latest.version };
          pendingConflict.current = pending;
          const persisted = writeRecoveryDraft(userId, pending);
          updateRecoveryDraftList([
            ...pendingConflicts.current.filter((draft) => draft.draftId !== pending.draftId),
            pending,
          ]);
          activateRecoveryDraft(pending, persisted);
          const canonical = applySnapshot(storeRef.current, latest.store);
          storeRef.current = canonical;
          lastSynced.current = sharedData(canonical);
          setLocalStore(canonical);
          setIssue({
            kind: 'save',
            message: `Votre modification sur ${changedSectionNames(changed)} a été refusée. Motif : ${serverRefusalReason(error) ?? 'un autre compte avait déjà modifié l’espace partagé.'} L’état distant de version ${latest.version} est maintenant affiché. Votre modification ${persisted ? 'est conservée pour ce compte et ne sera renvoyée que sur demande' : 'reste uniquement dans cet onglet, car le stockage local est indisponible'}.`,
          });
        } finally {
          pendingWrites.current -= 1;
        }
      });
    }
    if (previous.theme !== next.theme) {
      try { localStorage.setItem(localThemeKey, next.theme); } catch { /* optional local preference */ }
    }
  }, [status, userId, updateRecoveryDraftList, activateRecoveryDraft]);

  const resumeConflict = useCallback(async (choices?: ConflictChoices, reviewedVersion?: number) => {
    const pending = pendingConflict.current;
    const flight = recoveryFlight.current!;
    if (!pending || !flight.acquire()) return;
    if (!isCurrentRecovery(pending)) {
      flight.release();
      return;
    }
    setRecovery((current) => current ? { ...current, busy: true } : current);
    try {
      const attempt = await confirmSharedRecovery({
        choices,
        reviewedVersion,
        getLatest: getItsmWorkspace,
        save: (value, expectedVersion) => saveItsmWorkspace({ store: value as Store, version: expectedVersion }),
        isCurrent: () => isCurrentRecovery(pending),
        merge: (latest, validChoices) => {
          const remote = applySnapshot(storeRef.current, latest.store);
          return mergeSharedChanges(pending.base, pending.local, sharedData(remote), validChoices);
        },
        onLatest: (latest) => {
          version.current = latest.version;
          pending.remote = latest.store;
          pending.version = latest.version;
          if (writeRecoveryDraft(userId, pending)) draftGuard.current.track(pending, true);
          const remoteStore = applySnapshot(storeRef.current, latest.store);
          storeRef.current = remoteStore;
          lastSynced.current = sharedData(remoteStore);
          setLocalStore(remoteStore);
        },
      });
      if (attempt.kind === 'invalidated') return;
      if (attempt.kind === 'failed') throw attempt.error;
      if (attempt.kind === 'review' || attempt.kind === 'conflict') {
        const latest = attempt.latest;
        const remoteStore = applySnapshot(storeRef.current, latest.store);
        const conflicts = attempt.kind === 'review'
          ? attempt.conflicts
          : mergeSharedChanges(pending.base, pending.local, sharedData(remoteStore)).conflicts;
        version.current = latest.version;
        pending.remote = latest.store;
        pending.version = latest.version;
        if (writeRecoveryDraft(userId, pending)) draftGuard.current.track(pending, true);
        storeRef.current = remoteStore;
        lastSynced.current = sharedData(remoteStore);
        setLocalStore(remoteStore);
        setRecovery((current) => current ? {
          ...current,
          collisions: formatChangedPaths(conflicts),
          fields: recoveryFields(pending.local, sharedData(remoteStore), conflicts),
          remoteVersion: latest.version,
          busy: false,
        } : current);
        setIssue({
          kind: 'save',
          message: attempt.kind === 'review' && attempt.staleChoices
            ? 'L’espace a changé depuis votre comparaison. Relisez les nouvelles valeurs et confirmez à nouveau. Votre modification reste conservée ; rien n’a été enregistré.'
            : attempt.kind === 'conflict'
              ? 'L’espace a de nouveau changé pendant la reprise. Le nouvel état distant est affiché et votre modification reste conservée ; rien n’a été écrasé.'
              : conflicts.length
                ? 'Choisissez la valeur à conserver pour chaque champ en conflit, puis confirmez l’enregistrement. Les changements indépendants seront réunis ; rien n’a encore été enregistré.'
                : 'La comparaison est à jour et aucun champ ne reste en conflit. Confirmez la reprise pour enregistrer les changements indépendants ; rien n’a encore été enregistré.',
        });
        return;
      }
      const saved = attempt.saved;
      version.current = saved.version;
      const canonical = applySnapshot(storeRef.current, saved.store);
      storeRef.current = canonical;
      lastSynced.current = sharedData(canonical);
      setLocalStore(canonical);
      removeRecoveryDraft(localStorage, recoveryKey(userId), pending);
      const remaining = pendingConflicts.current.filter((draft) => draft.draftId !== pending.draftId)
        .map((draft) => ({ ...draft, remote: saved.store, version: saved.version }));
      updateRecoveryDraftList(remaining);
      pendingConflict.current = null;
      draftGuard.current.invalidate();
      if (remaining.length) {
        activateRecoveryDraft(remaining[0]!);
      } else {
        writeBlocked.current = false;
        setRecovery(null);
        setIssue(null);
      }
    } catch (error) {
      if (!isCurrentRecovery(pending)) return;
      setRecovery((current) => current ? { ...current, busy: false } : current);
      setIssue({
        kind: 'save',
        message: error instanceof Error
          ? `${error.message} Votre modification reste conservée pour ce compte.`
          : 'La reprise a échoué. Votre modification reste conservée pour ce compte.',
      });
    } finally {
      flight.release();
    }
  }, [userId, isCurrentRecovery, updateRecoveryDraftList, activateRecoveryDraft]);

  const acceptRemoteSnapshot = useCallback(() => {
    if (recoveryFlight.current?.isBusy) return;
    const pending = pendingConflict.current;
    if (!pending || !isCurrentRecovery(pending)) return;
    if (!removeRecoveryDraft(localStorage, recoveryKey(userId), pending)) {
      setIssue({
        kind: 'save',
        message: 'Le stockage du navigateur n’a pas confirmé la suppression. L’abandon n’est pas confirmé : cette modification peut réapparaître au rechargement et rester disponible dans un autre onglet. Rétablissez l’accès au stockage puis réessayez. Aucune autre modification n’a été supprimée.',
      });
      return;
    }
    const canonical = applySnapshot(storeRef.current, pending.remote);
    storeRef.current = canonical;
    setLocalStore(canonical);
    lastSynced.current = sharedData(canonical);
    version.current = pending.version;
    const remaining = pendingConflicts.current.filter((draft) => draft.draftId !== pending.draftId);
    updateRecoveryDraftList(remaining);
    pendingConflict.current = null;
    draftGuard.current.invalidate();
    if (remaining.length) {
      activateRecoveryDraft(remaining[0]!);
    } else {
      writeBlocked.current = false;
      setRecovery(null);
      setIssue(null);
    }
  }, [userId, isCurrentRecovery, updateRecoveryDraftList, activateRecoveryDraft]);

  useEffect(() => {
    if (status !== 'ready') return;
    const timer = window.setInterval(async () => {
      if (pendingWrites.current || writeBlocked.current) return;
      try {
        const latest = await getItsmWorkspace();
        if (latest.version > version.current) {
          version.current = latest.version;
          const hydrated = applySnapshot(storeRef.current, latest.store);
          storeRef.current = hydrated;
          lastSynced.current = sharedData(hydrated);
          setLocalStore(hydrated);
        }
      } catch {
        setIssue({ kind: 'load', message: 'La connexion à l’espace partagé est interrompue. Les données seront rechargées au retour de la connexion.' });
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [status]);

  const log = useCallback((action: string, scope: string) => {
    const at = new Date().toISOString();
    setStore((previous) => ({
      ...previous,
      audit: previous.profile.clearance.startsWith('N5')
        ? previous.audit
        : [{
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            action, actor: previous.profile.name, scope,
            at, time: at,
          }, ...previous.audit],
    }));
  }, [setStore]);
  const dismissIssue = useCallback(() => {
    if (!pendingConflict.current) setIssue(null);
  }, []);

  if (status === 'loading') return <main className="grid min-h-[100dvh] place-items-center text-sm text-muted-foreground">Chargement des données partagées…</main>;
  if (status === 'error') return <SyncPanel error={storageIssue?.message ?? 'Impossible de joindre le service ITSM.'} onRetry={() => setRetry((value) => value + 1)} />;

  return <StoreContext.Provider value={{
    store, setStore, log, storageIssue, dismissIssue, unreadableRecoveryDraftCount,
    recovery, recoveryDrafts, selectRecoveryDraft,
    resumeConflict, acceptRemoteSnapshot,
  }}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('StoreProvider manquant');
  return value;
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
