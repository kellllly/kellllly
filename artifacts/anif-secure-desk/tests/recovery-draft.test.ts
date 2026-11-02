import test from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryDraftGuard, recoveryKey, watchRecoveryDraft } from '../src/lib/recovery-draft.ts';

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function setup() {
  const storage = new MemoryStorage();
  const key = recoveryKey('same-account');
  const draft = { draftId: 'original', base: { title: 'Base' }, local: { title: 'Local' }, version: 1 };
  storage.setItem(key, JSON.stringify(draft));
  const tabs = [new EventTarget(), new EventTarget()];
  const guards = tabs.map(() => new RecoveryDraftGuard(key, () => storage));
  const drafts = tabs.map(() => JSON.parse(storage.getItem(key)!));
  guards.forEach((guard, index) => guard.track(drafts[index], true));
  return { storage, key, draft, tabs, guards, drafts };
}

test('two tabs: abandoning or completing recovery invalidates the other tab and stale callbacks', () => {
  for (const action of ['abandon', 'resume']) {
    const { storage, key, tabs, guards, drafts } = setup();
    const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    let visible = true;
    const unsubscribe = watchRecoveryDraft(tabs[1] as unknown as Window, key, () => {
      if (!guards[1].isCurrent(drafts[1])) {
        guards[1].invalidate();
        visible = false;
      }
    });
    let saves = 0;
    const staleResume = () => { if (guards[1].isCurrent(drafts[1])) saves++; };
    try {
      assert.equal(guards[0].isCurrent(drafts[0]), true);
      // Both successful resume and explicit abandon consume the persisted draft.
      if (action === 'resume') saves++;
      storage.removeItem(key);
      guards[0].invalidate();
      // A click already queued before the browser dispatches storage must also fail.
      staleResume();
      assert.equal(saves, action === 'resume' ? 1 : 0);
      const event = new Event('storage');
      Object.assign(event, { key, storageArea: storage });
      tabs[1].dispatchEvent(event);
      assert.equal(visible, false);
      staleResume();
      assert.equal(saves, action === 'resume' ? 1 : 0);
      assert.equal(storage.getItem(key), null);
    } finally {
      unsubscribe();
      if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  }
});

test('a delayed comparison cannot resurrect a consumed draft', async () => {
  const { storage, key, guards, drafts } = setup();
  let release!: () => void;
  const response = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  const comparison = (async () => {
    if (!guards[1].isCurrent(drafts[1])) return;
    await response;
    if (!guards[1].isCurrent(drafts[1])) return;
    writes++;
    storage.setItem(key, JSON.stringify(drafts[1]));
  })();
  storage.removeItem(key);
  release();
  await comparison;
  assert.equal(writes, 0);
  assert.equal(storage.getItem(key), null);
});

test('comparison updates preserve identity but replacement drafts block old actions', () => {
  const { storage, key, guards, drafts, draft } = setup();
  storage.setItem(key, JSON.stringify({ ...draft, version: 42, remote: { title: 'Latest' } }));
  assert.equal(guards[1].isCurrent(drafts[1]), true);
  storage.setItem(key, JSON.stringify({ ...draft, draftId: 'replacement' }));
  assert.equal(guards[1].isCurrent(drafts[1]), false);
});

test('account isolation and legacy drafts remain supported', () => {
  const { storage, key, guards, drafts } = setup();
  storage.removeItem(recoveryKey('another-account'));
  assert.equal(guards[1].isCurrent(drafts[1]), true);
  const legacy = { base: { title: 'Base' }, local: { title: 'Legacy' } };
  storage.setItem(key, JSON.stringify(legacy));
  guards[1].track(legacy, true);
  assert.equal(guards[1].isCurrent(legacy), true);
  storage.removeItem(key);
  assert.equal(guards[1].isCurrent(legacy), false);
});

test('inaccessible persisted storage fails closed; tab-only recovery remains explicit', () => {
  const draft = { draftId: 'tab-only', base: {}, local: {} };
  const guard = new RecoveryDraftGuard('key', () => { throw new Error('Access denied'); });
  guard.track(draft, true);
  assert.equal(guard.isCurrent(draft), false);
  guard.track(draft, false);
  assert.equal(guard.isCurrent(draft), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(draft), false);
});

test('listeners ignore other accounts/session storage, recheck on focus/clear, and detach', () => {
  const { storage, key, tabs } = setup();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  let checks = 0;
  const unsubscribe = watchRecoveryDraft(tabs[1] as unknown as Window, key, () => checks++);
  const send = (eventKey: string | null, storageArea: Storage) => {
    const event = new Event('storage');
    Object.assign(event, { key: eventKey, storageArea });
    tabs[1].dispatchEvent(event);
  };
  try {
    send(recoveryKey('another-account'), storage);
    send(key, new MemoryStorage());
    assert.equal(checks, 0);
    send(null, storage);
    tabs[1].dispatchEvent(new Event('focus'));
    assert.equal(checks, 2);
    unsubscribe();
    send(key, storage);
    tabs[1].dispatchEvent(new Event('focus'));
    assert.equal(checks, 2);
  } finally {
    unsubscribe();
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
