// Keeps a tab in step with the shared workspace without downloading it on
// every tick: the poller reads the version first and fetches the full
// snapshot only when another account has saved a newer one.

export const POLL_INTERVAL_MS = 5000;

export const CONNECTION_LOST_MESSAGE = 'La connexion à l’espace partagé est interrompue. Les données seront rechargées au retour de la connexion.';

export type PollSnapshot<S> = { store: S; version: number };

export type WorkspacePollDeps<S> = {
  /** Version the tab currently holds. */
  currentVersion: () => number;
  /** True while local edits are being saved or writes are suspended. */
  busy: () => boolean;
  getVersion: () => Promise<{ version: number }>;
  getWorkspace: () => Promise<PollSnapshot<S>>;
  apply: (snapshot: PollSnapshot<S>) => void;
  onError: (error: unknown) => void;
  /** Called once after a failure when the connection works again. */
  onRecovered: () => void;
};

export type WorkspacePoller = {
  /** Runs one check; concurrent calls share the check in flight. */
  tick: () => Promise<void>;
};

export function createWorkspacePoller<S>(deps: WorkspacePollDeps<S>): WorkspacePoller {
  let inFlight: Promise<void> | null = null;
  let failing = false;

  const run = async () => {
    if (deps.busy()) return;
    try {
      const { version } = await deps.getVersion();
      if (version > deps.currentVersion() && !deps.busy()) {
        const latest = await deps.getWorkspace();
        // A local edit may have started while the request was in flight: the
        // save path owns reconciliation then, so the snapshot is not applied.
        if (!deps.busy() && latest.version > deps.currentVersion()) deps.apply(latest);
      }
      if (failing) {
        failing = false;
        deps.onRecovered();
      }
    } catch (error) {
      failing = true;
      deps.onError(error);
    }
  };

  return {
    tick() {
      inFlight ??= run().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

type VisibilityTarget = {
  readonly hidden: boolean;
  addEventListener: (type: 'visibilitychange', listener: () => void) => void;
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void;
};

type Timers = {
  setInterval: (handler: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
};

/**
 * Polls while the tab is visible, pauses while it is hidden and checks
 * immediately when it becomes visible again. Returns a stop function.
 */
export function startVisiblePolling(
  poller: WorkspacePoller,
  doc: VisibilityTarget,
  timers: Timers,
  intervalMs = POLL_INTERVAL_MS,
): () => void {
  let timer: number | null = null;
  const stopTimer = () => {
    if (timer !== null) timers.clearInterval(timer);
    timer = null;
  };
  const startTimer = () => {
    if (timer === null) timer = timers.setInterval(() => { void poller.tick(); }, intervalMs);
  };
  const onVisibility = () => {
    if (doc.hidden) {
      stopTimer();
      return;
    }
    void poller.tick();
    startTimer();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  if (!doc.hidden) startTimer();
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    stopTimer();
  };
}
