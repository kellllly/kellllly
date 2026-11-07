import { createContext, useCallback, useContext, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useClerk, useUser } from '@clerk/react';
import { getItsmWorkspace, getItsmWorkspaceVersion, importItsmExamples, saveItsmWorkspace } from '@workspace/api-client-react';
import { CONNECTION_LOST_MESSAGE, createWorkspacePoller, startVisiblePolling } from '@/lib/workspace-poll';
import { migrate } from './seed';
import { readDemoStore, type StorageIssue } from './storage';
import { RecoveryDraftGuard, recoveryKey, watchRecoveryDraft } from './recovery-draft';
import {
  changedPaths, confirmSharedRecovery, conflictDetails, mergeSharedChanges, RecoveryFlightGuard,
  recoveryEditDetails, serverRefusalReason, type ConflictChoices,
} from './sync-recovery';
import { saveRefusalOutcome, SUSPENDED_EDIT_MESSAGE } from './save-refusal';
import type { Store } from './types';

export { STORAGE_KEY } from './storage';

type SharedData = Pick<Store, 'tickets' | 'conversations' | 'services' | 'assets' | 'audit' | 'kedb' | 'notifications' | 'seeded' | 'schema'>;
type Ctx = {
  store: Store;
  setStore: Dispatch<SetStateAction<Store>>;
  log: (action: string, scope: string) => void;
  storageIssue: StorageIssue;
  dismissIssue: () => void;
  recovery: SyncRecovery | null;
  resumeConflict: (choices?: ConflictChoices, reviewedVersion?: number) => Promise<void>;
  acceptRemoteSnapshot: () => void;
  /** True while this tab refuses shared edits (refused save not yet reconciled). */
  writesSuspended: boolean;
  /** Reload the canonical shared workspace and resume saving. */
  resync: () => void;
};
type SyncRecovery = {
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

function readRecoveryDraft(userId: string): PendingConflict | null {
  try {
    const raw = localStorage.getItem(recoveryKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid recovery draft');
    const draft = parsed as Partial<PendingConflict>;
    if (!isSharedData(draft.base) || !isSharedData(draft.local)
      || (draft.draftId !== undefined && typeof draft.draftId !== 'string')
      || !draft.remote || typeof draft.remote !== 'object' || Array.isArray(draft.remote)
      || typeof draft.version !== 'number' || !Number.isFinite(draft.version)) {
      throw new Error('Invalid recovery draft');
    }
    return draft as PendingConflict;
  } catch {
    try { localStorage.removeItem(recoveryKey(userId)); } catch { /* Leave inaccessible storage untouched. */ }
    return null;
  }
}

function writeRecoveryDraft(userId: string, pending: PendingConflict): boolean {
  try {
    localStorage.setItem(recoveryKey(userId), JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function clearSyncRecoveryDraft(userId: string): void {
  try { localStorage.removeItem(recoveryKey(userId)); } catch { /* Best effort during logout. */ }
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
  const [retry, setRetry] = useState(0);
  const version = useRef(0);
  const lastSynced = useRef(sharedData(store));
  const pendingConflict = useRef<PendingConflict | null>(null);
  const [recovery, setRecovery] = useState<SyncRecovery | null>(null);
  const writeQueue = useRef(Promise.resolve());
  const writeBlocked = useRef(false);
  const [writesSuspended, setWritesSuspended] = useState(false);
  const blockWrites = (blocked: boolean) => {
    writeBlocked.current = blocked;
    setWritesSuspended(blocked);
  };
  // Saves queued before a refusal carry the refused snapshot; they must not be replayed.
  const writeGeneration = useRef(0);
  const pendingWrites = useRef(0);
  const recoveryFlight = useRef<RecoveryFlightGuard | null>(null);
  recoveryFlight.current ??= new RecoveryFlightGuard();
  const draftGuard = useRef(new RecoveryDraftGuard(recoveryKey(userId), () => localStorage));

  const invalidateRecovery = useCallback(() => {
    draftGuard.current.invalidate();
    pendingConflict.current = null;
    setRecovery(null);
    // Keep writes blocked until the canonical snapshot has been fetched.
    blockWrites(true);
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
  }), [userId, isCurrentRecovery]);

  const hydrate = useCallback(async () => {
    setStatus('loading');
    blockWrites(false);
    try {
      const source = local.current!;
      const savedDraft = readRecoveryDraft(userId);
      if (savedDraft) draftGuard.current.track(savedDraft, true);
      const current = await getItsmWorkspace();
      const currentClearance = (current.store.profile as { clearance?: unknown } | undefined)?.clearance;
      const role = typeof currentClearance === 'string' ? currentClearance.slice(0, 2) : '';
      let imported = current;
      if (!savedDraft && ['N1', 'N2', 'N3'].includes(role)) {
        imported = await importItsmExamples({ store: sharedData(source.store) });
      }
      if (current.version > imported.version) imported = await getItsmWorkspace();
      version.current = imported.version;
      const hydrated = applySnapshot(storeRef.current, imported.store);
      storeRef.current = hydrated;
      lastSynced.current = sharedData(hydrated);
      setLocalStore(hydrated);
      if (savedDraft && draftGuard.current.isCurrent(savedDraft)) {
        const pending: PendingConflict = {
          ...savedDraft,
          remote: imported.store,
          version: imported.version,
        };
        pendingConflict.current = pending;
        draftGuard.current.track(pending, true);
        blockWrites(true);
        const changed = changedPaths(pending.base, pending.local);
        const collisions = mergeSharedChanges(
          pending.base,
          pending.local,
          sharedData(hydrated),
        ).conflicts;
        setRecovery({
          changed: formatChangedPaths(changed),
          collisions: formatChangedPaths(collisions),
          fields: recoveryFields(pending.local, sharedData(hydrated), collisions),
          localEdits: localEditDetails(pending.local, changed),
          remoteVersion: imported.version,
          busy: false,
        });
        setIssue({
          kind: 'save',
          message: 'Une modification refusée, conservée pour ce compte, a été retrouvée. Elle n’a pas été renvoyée. Reprenez-la explicitement ou abandonnez-la.',
        });
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
  }, [userId]);

  useEffect(() => { void hydrate(); }, [hydrate, retry]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', store.theme === 'dark');
    try { localStorage.setItem(localThemeKey, store.theme); } catch { /* optional local preference */ }
  }, [store.theme]);

  const setStore = useCallback<Dispatch<SetStateAction<Store>>>((action) => {
    const previous = storeRef.current;
    const next = typeof action === 'function' ? action(previous) : action;
    const sharedChanged = JSON.stringify(sharedData(previous)) !== JSON.stringify(sharedData(next));
    if (writeBlocked.current && sharedChanged) {
      // Never drop an edit silently: say why it was not applied.
      if (!pendingConflict.current) setIssue({ kind: 'save', message: SUSPENDED_EDIT_MESSAGE });
      return;
    }
    storeRef.current = next;
    setLocalStore(next);
    const before = JSON.stringify(sharedData(previous));
    const after = JSON.stringify(sharedData(next));
    if (status === 'ready' && before !== after) {
      const captured = sharedData(next);
      const generation = writeGeneration.current;
      pendingWrites.current += 1;
      writeQueue.current = writeQueue.current.then(async () => {
        if (writeBlocked.current || generation !== writeGeneration.current) return;
        try {
          const saved = await saveItsmWorkspace({ store: captured, version: version.current });
          version.current = saved.version;
          const canonical = applySnapshot(storeRef.current, saved.store);
          storeRef.current = canonical;
          lastSynced.current = sharedData(canonical);
          setLocalStore(canonical);
        } catch (error) {
          blockWrites(true);
          writeGeneration.current += 1;
          const base = lastSynced.current;
          const localChanges = sharedData(storeRef.current);
          const changed = changedPaths(base, localChanges);
          if (!isVersionConflict(error)) {
            let refreshed = false;
            try {
              const latest = await getItsmWorkspace();
              version.current = latest.version;
              const canonical = applySnapshot(storeRef.current, latest.store);
              storeRef.current = canonical;
              lastSynced.current = sharedData(canonical);
              setLocalStore(canonical);
              refreshed = true;
            } catch { /* Keep writes suspended; the person can resynchronize explicitly. */ }
            const outcome = saveRefusalOutcome(error, refreshed);
            if (outcome.resumeWrites) blockWrites(false);
            setIssue({ kind: 'save', message: outcome.message });
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
            draftGuard.current.track(pending, persisted);
            setRecovery({
              changed: formatChangedPaths(changed),
              collisions: [],
              fields: [],
              localEdits: localEditDetails(localChanges, changed),
              remoteVersion: version.current,
              busy: false,
            });
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
          draftGuard.current.track(pending, persisted);
          setRecovery({
            changed: formatChangedPaths(changed),
            collisions: formatChangedPaths(collisions),
            fields: recoveryFields(localChanges, sharedData(applySnapshot(storeRef.current, latest.store)), collisions),
            localEdits: localEditDetails(localChanges, changed),
            remoteVersion: latest.version,
            busy: false,
          });
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
  }, [status, userId]);

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
      pendingConflict.current = null;
      draftGuard.current.invalidate();
      clearSyncRecoveryDraft(userId);
      blockWrites(false);
      setRecovery(null);
      setIssue(null);
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
  }, [userId, isCurrentRecovery]);

  const acceptRemoteSnapshot = useCallback(() => {
    if (recoveryFlight.current?.isBusy) return;
    const pending = pendingConflict.current;
    if (!pending || !isCurrentRecovery(pending)) return;
    if (pending) {
      lastSynced.current = sharedData(applySnapshot(storeRef.current, pending.remote));
      version.current = pending.version;
    }
    pendingConflict.current = null;
    draftGuard.current.invalidate();
    clearSyncRecoveryDraft(userId);
    blockWrites(false);
    setRecovery(null);
    setIssue(null);
  }, [userId, isCurrentRecovery]);

  useEffect(() => {
    if (status !== 'ready') return;
    const poller = createWorkspacePoller({
      currentVersion: () => version.current,
      busy: () => pendingWrites.current > 0 || writeBlocked.current,
      getVersion: getItsmWorkspaceVersion,
      getWorkspace: getItsmWorkspace,
      apply: (latest) => {
        version.current = latest.version;
        const hydrated = applySnapshot(storeRef.current, latest.store);
        storeRef.current = hydrated;
        lastSynced.current = sharedData(hydrated);
        setLocalStore(hydrated);
      },
      onError: () => {
        setIssue((current) => current && current.kind === 'save' ? current : { kind: 'load', message: CONNECTION_LOST_MESSAGE });
      },
      onRecovered: () => {
        setIssue((current) => current?.message === CONNECTION_LOST_MESSAGE ? null : current);
      },
    });
    return startVisiblePolling(poller, document, window);
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
  const resync = useCallback(() => {
    if (pendingConflict.current) return; // The recovery panel owns that decision.
    setIssue(null);
    setRetry((value) => value + 1);
  }, []);

  if (status === 'loading') return <main className="grid min-h-[100dvh] place-items-center text-sm text-muted-foreground">Chargement des données partagées…</main>;
  if (status === 'error') return <SyncPanel error={storageIssue?.message ?? 'Impossible de joindre le service ITSM.'} onRetry={() => setRetry((value) => value + 1)} />;

  return <StoreContext.Provider value={{
    store, setStore, log, storageIssue, dismissIssue, recovery, resumeConflict, acceptRemoteSnapshot,
    writesSuspended, resync,
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
