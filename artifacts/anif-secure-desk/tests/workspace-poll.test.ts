import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspacePoller, startVisiblePolling, type WorkspacePollDeps } from '../src/lib/workspace-poll.ts';

type Store = { label: string };

function harness(overrides: Partial<WorkspacePollDeps<Store>> = {}) {
  const state = { version: 3, applied: [] as number[], errors: 0, recovered: 0, fullFetches: 0, busy: false };
  const deps: WorkspacePollDeps<Store> = {
    currentVersion: () => state.version,
    busy: () => state.busy,
    getVersion: async () => ({ version: 3 }),
    getWorkspace: async () => { state.fullFetches += 1; return { store: { label: 'remote' }, version: 4 }; },
    apply: (snapshot) => { state.applied.push(snapshot.version); state.version = snapshot.version; },
    onError: () => { state.errors += 1; },
    onRecovered: () => { state.recovered += 1; },
    ...overrides,
  };
  return { state, poller: createWorkspacePoller(deps) };
}

test('an unchanged version does not download the workspace', async () => {
  const { state, poller } = harness();
  await poller.tick();
  assert.equal(state.fullFetches, 0);
  assert.deepEqual(state.applied, []);
});

test('a newer version fetches and applies the snapshot once', async () => {
  const { state, poller } = harness({ getVersion: async () => ({ version: 4 }) });
  await poller.tick();
  await poller.tick();
  assert.equal(state.fullFetches, 1);
  assert.deepEqual(state.applied, [4]);
});

test('a local edit started during the request is not overwritten', async () => {
  const ctx = harness({
    getVersion: async () => ({ version: 4 }),
    getWorkspace: async () => { ctx.state.busy = true; return { store: { label: 'remote' }, version: 4 }; },
  });
  await ctx.poller.tick();
  assert.deepEqual(ctx.state.applied, []);
});

test('nothing is requested while writes are pending or suspended', async () => {
  let calls = 0;
  const { state, poller } = harness({ getVersion: async () => { calls += 1; return { version: 9 }; } });
  state.busy = true;
  await poller.tick();
  assert.equal(calls, 0);
});

test('overlapping ticks share one request', async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const { poller } = harness({ getVersion: async () => { calls += 1; await gate; return { version: 3 }; } });
  const first = poller.tick();
  const second = poller.tick();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('a recovered connection is reported once after a failure', async () => {
  let fail = true;
  const { state, poller } = harness({
    getVersion: async () => { if (fail) throw new TypeError('Failed to fetch'); return { version: 3 }; },
  });
  await poller.tick();
  assert.equal(state.errors, 1);
  fail = false;
  await poller.tick();
  await poller.tick();
  assert.equal(state.recovered, 1);
});

test('polling pauses in hidden tabs and checks at once when visible again', async () => {
  const listeners: Array<() => void> = [];
  const doc = {
    hidden: false,
    addEventListener: (_: 'visibilitychange', fn: () => void) => { listeners.push(fn); },
    removeEventListener: (_: 'visibilitychange', fn: () => void) => { listeners.splice(listeners.indexOf(fn), 1); },
  };
  const active = new Set<number>();
  let nextId = 1;
  const timers = {
    setInterval: () => { const id = nextId++; active.add(id); return id; },
    clearInterval: (id: number) => { active.delete(id); },
  };
  let ticks = 0;
  const stop = startVisiblePolling({ tick: async () => { ticks += 1; } }, doc, timers, 1000);
  assert.equal(active.size, 1);
  doc.hidden = true;
  listeners.forEach((fn) => fn());
  assert.equal(active.size, 0);
  doc.hidden = false;
  listeners.forEach((fn) => fn());
  assert.equal(ticks, 1);
  assert.equal(active.size, 1);
  stop();
  assert.equal(active.size, 0);
  assert.equal(listeners.length, 0);
});
