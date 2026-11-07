import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearRecoveryDrafts, readRecoveryDrafts, readRecoveryDraftsWithStatus, RecoveryDraftGuard, recoveryKey, removeRecoveryDraft, watchRecoveryDraft,
  writeRecoveryDraft,
} from '../src/lib/recovery-draft.ts';

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

test('malformed JSON recovery drafts are reported and preserved verbatim', () => {
  const storage = new MemoryStorage();
  const key = recoveryKey('damaged-json');
  const malformed = '{"base":';
  storage.setItem(key, malformed);

  const result = readRecoveryDraftsWithStatus(storage, key);

  assert.deepEqual(result, { drafts: [], unreadableCount: 1 });
  assert.equal(storage.getItem(key), malformed);
});

test('invalid recovery draft schemas are reported and preserved verbatim', () => {
  const storage = new MemoryStorage();
  const key = recoveryKey('damaged-schema');
  const invalidSchema = JSON.stringify({ draftId: 42, local: { title: 'Local' } });
  storage.setItem(`${key}:draft:bad-schema`, invalidSchema);

  const result = readRecoveryDraftsWithStatus(storage, key);

  assert.deepEqual(result, { drafts: [], unreadableCount: 1 });
  assert.equal(storage.getItem(`${key}:draft:bad-schema`), invalidSchema);
});

test('cleanup leaves unreadable JSON and schema-invalid drafts in place', () => {
  const storage = new MemoryStorage();
  const key = recoveryKey('cleanup-invalid');
  const malformedJson = '{"base":';
  const invalidSchema = JSON.stringify({ draftId: 8, local: {} });
  storage.setItem(key, malformedJson);
  storage.setItem(`${key}:draft:bad-schema`, invalidSchema);

  assert.equal(clearRecoveryDrafts(storage, key), false);
  assert.equal(storage.getItem(key), malformedJson);
  assert.equal(storage.getItem(`${key}:draft:bad-schema`), invalidSchema);
});

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
      assert.equal(removeRecoveryDraft(storage, key, drafts[0]), true);
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

test('two tabs persist different drafts independently; resuming and abandoning one keep the other actionable', () => {
  const storage = new MemoryStorage();
  const key = recoveryKey('same-account');
  const draftA = { draftId: 'tab-a', base: { title: 'Base' }, local: { title: 'Change A' }, version: 1 };
  const draftB = { draftId: 'tab-b', base: { title: 'Base' }, local: { title: 'Change B' }, version: 1 };
  const tabA = new RecoveryDraftGuard(key, () => storage);
  const tabB = new RecoveryDraftGuard(key, () => storage);

  assert.equal(writeRecoveryDraft(storage, key, draftA), true);
  tabA.track(draftA, true);
  assert.equal(writeRecoveryDraft(storage, key, draftB), true);
  tabB.track(draftB, true);
  assert.deepEqual(readRecoveryDrafts(storage, key).map((draft) => draft.draftId), ['tab-a', 'tab-b']);
  assert.equal(tabA.isCurrent(draftA), true);
  assert.equal(tabB.isCurrent(draftB), true);

  // Tab A completes its explicitly requested resume. This consumes only A's entry.
  let resumes = 0;
  if (tabA.isCurrent(draftA)) resumes += 1;
  removeRecoveryDraft(storage, key, draftA);
  assert.equal(resumes, 1);
  assert.equal(tabA.isCurrent(draftA), false);
  assert.equal(tabB.isCurrent(draftB), true);
  assert.deepEqual(readRecoveryDrafts(storage, key).map((draft) => draft.draftId), ['tab-b']);

  // Tab B can still abandon its own change without resuming or deleting A again.
  removeRecoveryDraft(storage, key, draftB);
  assert.equal(tabB.isCurrent(draftB), false);
  assert.deepEqual(readRecoveryDrafts(storage, key), []);
});

test('failed explicit abandon stays visible after storage recovers, reloads, and in another tab', () => {
  const { storage, key, draft, tabs, guards, drafts } = setup();
  const otherDraft = { draftId: 'other-tab', base: { title: 'Base' }, local: { title: 'Other change' } };
  assert.equal(writeRecoveryDraft(storage, key, otherDraft), true);
  const otherTabGuard = new RecoveryDraftGuard(key, () => storage);
  otherTabGuard.track(drafts[1], true);
  const independentDraftGuard = new RecoveryDraftGuard(key, () => storage);
  independentDraftGuard.track(otherDraft, true);
  const originalRemove = storage.removeItem.bind(storage);
  let storageBlocked = true;
  storage.removeItem = (itemKey: string) => {
    if (storageBlocked) throw new Error('Storage access denied');
    originalRemove(itemKey);
  };

  assert.equal(removeRecoveryDraft(storage, key, drafts[0]), false);
  assert.deepEqual(readRecoveryDrafts(storage, key).map((item) => item.draftId), [draft.draftId, otherDraft.draftId]);
  assert.equal(guards[0].isCurrent(drafts[0]), true);
  assert.equal(otherTabGuard.isCurrent(drafts[1]), true);
  // A reload reads the persisted draft again; a failed attempt did not claim success.
  assert.deepEqual(readRecoveryDrafts(storage, key).map((item) => item.draftId), [draft.draftId, otherDraft.draftId]);

  storageBlocked = false;
  assert.equal(removeRecoveryDraft(storage, key, drafts[0]), true);
  guards[0].invalidate();
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  let abandonedDraftStillVisible = true;
  const unsubscribe = watchRecoveryDraft(tabs[1] as unknown as Window, key, () => {
    if (!otherTabGuard.isCurrent(drafts[1])) abandonedDraftStillVisible = false;
  });
  const event = new Event('storage');
  Object.assign(event, { key, storageArea: storage });
  try {
    tabs[1]!.dispatchEvent(event);
    assert.equal(abandonedDraftStillVisible, false);
    assert.equal(independentDraftGuard.isCurrent(otherDraft), true);
    assert.deepEqual(readRecoveryDrafts(storage, key).map((item) => item.draftId), [otherDraft.draftId]);
  } finally {
    unsubscribe();
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('clear reports blocked storage and verifies account-scoped cleanup after recovery', () => {
  const { storage, key, draft } = setup();
  storage.setItem(recoveryKey('another-account'), JSON.stringify(draft));
  const originalRemove = storage.removeItem.bind(storage);
  storage.removeItem = () => { throw new Error('Storage access denied'); };
  assert.equal(clearRecoveryDrafts(storage, key), false);
  assert.equal(readRecoveryDrafts(storage, key).length, 1);
  storage.removeItem = originalRemove;
  assert.equal(clearRecoveryDrafts(storage, key), true);
  assert.equal(readRecoveryDrafts(storage, key).length, 0);
  assert.equal(readRecoveryDrafts(storage, recoveryKey('another-account')).length, 1);
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
