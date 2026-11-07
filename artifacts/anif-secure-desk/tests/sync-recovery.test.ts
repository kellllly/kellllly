import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changedPaths, choicesForRecoveryVersion, confirmSharedRecovery, conflictDetails, mergeSharedChanges,
  RecoveryFlightGuard, rebaseAfterSave,
} from '../src/lib/sync-recovery.ts';

test('recovery combines independent ticket edits while preserving both writers', () => {
  const base = {
    tickets: [
      { id: 'INC-1', title: 'Base', status: 'Nouveau' },
      { id: 'INC-2', title: 'Autre base', status: 'Nouveau' },
    ],
  };
  const local = {
    tickets: [
      { id: 'INC-1', title: 'Titre local', status: 'Nouveau' },
      { id: 'INC-2', title: 'Autre base', status: 'Nouveau' },
      { id: 'INC-3', title: 'Nouveau ticket local', status: 'Nouveau' },
    ],
  };
  const remote = {
    tickets: [
      { id: 'INC-1', title: 'Base', status: 'Pris en compte' },
      { id: 'INC-2', title: 'Autre base', status: 'Nouveau' },
      { id: 'INC-4', title: 'Nouveau ticket distant', status: 'Nouveau' },
    ],
  };

  const result = mergeSharedChanges(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.value, {
    tickets: [
      { id: 'INC-1', title: 'Titre local', status: 'Pris en compte' },
      { id: 'INC-2', title: 'Autre base', status: 'Nouveau' },
      { id: 'INC-4', title: 'Nouveau ticket distant', status: 'Nouveau' },
      { id: 'INC-3', title: 'Nouveau ticket local', status: 'Nouveau' },
    ],
  });
});

test('recovery refuses divergent edits to the same field and identifies the collision', () => {
  const base = { tickets: [{ id: 'INC-1', title: 'Base', status: 'Nouveau' }] };
  const local = { tickets: [{ id: 'INC-1', title: 'Titre local', status: 'Nouveau' }] };
  const remote = { tickets: [{ id: 'INC-1', title: 'Titre distant', status: 'Nouveau' }] };

  const result = mergeSharedChanges(base, local, remote);
  assert.equal(result.value, undefined);
  assert.deepEqual(result.conflicts, ['tickets.INC-1.title']);
  assert.deepEqual(changedPaths(base, local), ['tickets.INC-1.title']);
});

test('explicit mixed choices keep independent changes from both writers without mutating the draft', () => {
  const base = { tickets: [{ id: '1', title: 'Base', status: 'Nouveau', assignee: '', description: '' }], audit: [] };
  const local = { tickets: [{ id: '1', title: 'Local', status: 'En cours', assignee: 'Local', description: '' }], audit: [{ id: 'local' }] };
  const remote = { tickets: [{ id: '1', title: 'Distant', status: 'Résolu', assignee: '', description: 'Distant' }], audit: [{ id: 'remote' }] };
  const original = JSON.stringify({ base, local, remote });
  assert.deepEqual(mergeSharedChanges(base, local, remote, { 'tickets.1.title': 'local' }).conflicts, ['tickets.1.status']);
  const merged = mergeSharedChanges(base, local, remote, {
    'tickets.1.title': 'local', 'tickets.1.status': 'remote',
  });
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.value?.tickets, [{ id: '1', title: 'Local', status: 'Résolu', assignee: 'Local', description: 'Distant' }]);
  assert.deepEqual(merged.value?.audit, [{ id: 'remote' }, { id: 'local' }]);
  assert.equal(JSON.stringify({ base, local, remote }), original);
});

test('delete versus edit and simultaneous creation can be resolved in either direction', () => {
  const base = { items: [{ id: '1', title: 'Base' }] };
  const local = { items: [] as { id: string; title: string }[] };
  const remote = { items: [{ id: '1', title: 'Distant' }] };
  assert.deepEqual(mergeSharedChanges(base, local, remote).conflicts, ['items.1']);
  assert.deepEqual(mergeSharedChanges(base, local, remote, { 'items.1': 'local' }).value, local);
  assert.deepEqual(mergeSharedChanges(base, local, remote, { 'items.1': 'remote' }).value, remote);
  assert.deepEqual(mergeSharedChanges(local, base, remote, { 'items.1': 'local' }).value, base);
  assert.deepEqual(mergeSharedChanges(local, base, remote, { 'items.1': 'remote' }).value, remote);
  assert.match(conflictDetails(local, remote, ['items.1'])[0].local, /supprimée/);
});

test('ordering choices do not discard independent edits inside reordered collections', () => {
  const base = { items: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }] };
  const local = { items: [{ id: 'b', title: 'B local' }, base.items[0], base.items[2]] };
  const remote = { items: [{ id: 'c', title: 'C distant' }, base.items[1], base.items[0]] };
  assert.deepEqual(mergeSharedChanges(base, local, remote).conflicts, ['items.$order']);
  const merged = mergeSharedChanges(base, local, remote, { 'items.$order': 'local' });
  assert.deepEqual(merged.value?.items, [
    { id: 'b', title: 'B local' }, { id: 'a', title: 'A' }, { id: 'c', title: 'C distant' },
  ]);
  assert.equal(conflictDetails(local, remote, ['items.$order'])[0].local, JSON.stringify(['b', 'a', 'c'], null, 2));
});

test('every conflict is exposed, including more than twenty fields, nulls and primitive arrays', () => {
  const base = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`field${i}`, 'base']));
  const local = Object.fromEntries(Object.keys(base).map((key) => [key, 'local']));
  const remote = Object.fromEntries(Object.keys(base).map((key) => [key, 'remote']));
  assert.equal(conflictDetails(local, remote, mergeSharedChanges(base, local, remote).conflicts).length, 25);
  assert.deepEqual(mergeSharedChanges({ value: ['a'] }, { value: [] }, { value: ['b'] }, { value: 'remote' }).value, { value: ['b'] });
  assert.equal(conflictDetails({ value: null }, {}, ['value'])[0].local, 'null');
});

test('a PUT conflict after a valid comparison refreshes the draft and requires new confirmation', async () => {
  const base = { tickets: [{ id: '1', title: 'Base', status: 'Nouveau' }], audit: [] as { id: string }[] };
  const local = { tickets: [{ id: '1', title: 'Ma valeur', status: 'Nouveau' }], audit: [{ id: 'local-audit' }] };
  const firstRemote = { tickets: [{ id: '1', title: 'Valeur distante A', status: 'Nouveau' }], audit: [] };
  const newestRemote = { tickets: [{ id: '1', title: 'Valeur distante B', status: 'Nouveau' }], audit: [{ id: 'remote-audit' }] };
  const draft = structuredClone({ base, local, remote: firstRemote, version: 10 });
  let puts = 0;
  let fetches = 0;
  const attempt = await confirmSharedRecovery({
    choices: { 'tickets.1.title': 'local' },
    reviewedVersion: 10,
    getLatest: async () => {
      fetches++;
      return { store: firstRemote, version: 10 };
    },
    save: async () => {
      puts++;
      throw { status: 409, data: { current: { store: newestRemote, version: 11 } } };
    },
    merge: (latest, choices) => mergeSharedChanges(base, local, latest.store, choices),
    isCurrent: () => true,
  });

  assert.equal(attempt.kind, 'conflict');
  if (attempt.kind !== 'conflict') return;
  assert.equal(attempt.latest.version, 11);
  assert.equal(attempt.latest.store, newestRemote);
  assert.deepEqual(mergeSharedChanges(base, local, newestRemote).conflicts, ['tickets.1.title']);
  assert.deepEqual(choicesForRecoveryVersion(11, 10, { 'tickets.1.title': 'local' }), {});
  assert.deepEqual(draft, { base, local, remote: firstRemote, version: 10 });
  assert.equal(puts, 1, 'the stale choice must not be submitted again automatically');
  assert.equal(fetches, 1);

  // A second request represents a new click after reviewing the refreshed remote value.
  const explicitlyConfirmed = await confirmSharedRecovery({
    choices: { 'tickets.1.title': 'local' },
    reviewedVersion: 11,
    getLatest: async () => ({ store: newestRemote, version: 11 }),
    save: async (value, version) => {
      puts++;
      assert.equal(version, 11);
      assert.equal((value as typeof local).tickets[0].title, 'Ma valeur');
      return { store: value as Record<string, unknown>, version: 12 };
    },
    merge: (latest, choices) => mergeSharedChanges(base, local, latest.store, choices),
    isCurrent: () => true,
  });
  assert.equal(explicitlyConfirmed.kind, 'saved');
  assert.equal(puts, 2);
});

test('a double confirmation runs one GET and one PUT', async () => {
  const base = { tickets: [{ id: '1', title: 'Base' }] };
  const local = { tickets: [{ id: '1', title: 'Local' }] };
  const remote = { tickets: [{ id: '1', title: 'Distant' }] };
  const guard = new RecoveryFlightGuard();
  let gets = 0;
  let puts = 0;
  let releaseGet!: () => void;
  const waiting = new Promise<void>((resolve) => { releaseGet = resolve; });
  const confirm = async () => {
    if (!guard.acquire()) return 'ignored';
    try {
      const result = await confirmSharedRecovery({
        choices: { 'tickets.1.title': 'local' },
        reviewedVersion: 4,
        getLatest: async () => {
          gets++;
          await waiting;
          return { store: remote, version: 4 };
        },
        save: async (value, version) => {
          puts++;
          return { store: value as Record<string, unknown>, version: version + 1 };
        },
        merge: (latest, choices) => mergeSharedChanges(base, local, latest.store, choices),
        isCurrent: () => true,
      });
      return result.kind;
    } finally {
      guard.release();
    }
  };
  const first = confirm();
  const second = confirm();
  assert.equal(guard.isBusy, true);
  releaseGet();
  assert.deepEqual(await Promise.all([first, second]), ['saved', 'ignored']);
  assert.equal(gets, 1);
  assert.equal(puts, 1);
  assert.equal(guard.isBusy, false);
});

test('network failure preserves local and independent edits without retrying', async () => {
  const base = {
    tickets: [{ id: '1', title: 'Base', status: 'Nouveau' }],
    audit: [] as { id: string }[],
  };
  const local = {
    tickets: [{ id: '1', title: 'Titre local', status: 'Nouveau' }],
    audit: [{ id: 'local-audit' }],
  };
  const remote = {
    tickets: [{ id: '1', title: 'Base', status: 'En cours' }],
    audit: [{ id: 'remote-audit' }],
  };
  const draftBefore = structuredClone(local);
  let puts = 0;
  let attemptedValue: typeof local | undefined;
  const result = await confirmSharedRecovery({
    choices: {},
    reviewedVersion: 6,
    getLatest: async () => ({ store: remote, version: 6 }),
    save: async (value) => {
      puts++;
      attemptedValue = value as typeof local;
      throw new Error('Réseau indisponible');
    },
    merge: (latest, choices) => mergeSharedChanges(base, local, latest.store, choices),
    isCurrent: () => true,
  });

  assert.equal(result.kind, 'failed');
  assert.deepEqual(attemptedValue?.tickets, [{ id: '1', title: 'Titre local', status: 'En cours' }]);
  assert.deepEqual(attemptedValue?.audit, [{ id: 'remote-audit' }, { id: 'local-audit' }]);
  assert.deepEqual(local, draftBefore, 'the saved local draft must remain unchanged');
  assert.equal(puts, 1, 'a network failure must not trigger an automatic retry');
});

test('a save adopts server message IDs and keeps the read count changed while it was in flight', () => {
  const sent = { conversations: [{ id: 'C-1', readCount: 1, messages: [{ id: 'm-old', body: 'Ancien' }, { id: 'client-1', body: 'Nouveau' }] }] };
  const local = { conversations: [{ id: 'C-1', readCount: 2, messages: [{ id: 'm-old', body: 'Ancien' }, { id: 'client-1', body: 'Nouveau' }] }] };
  const saved = { conversations: [{ id: 'C-1', readCount: 1, messages: [{ id: 'm-old', body: 'Ancien' }, { id: 'server-1', body: 'Nouveau', author: 'user_a' }] }] };
  assert.deepEqual(rebaseAfterSave(sent, local, saved), {
    conversations: [{ id: 'C-1', readCount: 2, messages: [{ id: 'm-old', body: 'Ancien' }, { id: 'server-1', body: 'Nouveau', author: 'user_a' }] }],
  });
});

test('a save keeps a message written while it was in flight, after the server copy', () => {
  const sent = { conversations: [{ id: 'C-1', messages: [{ id: 'client-1', body: 'Un' }] }] };
  const local = { conversations: [{ id: 'C-1', messages: [{ id: 'client-1', body: 'Un' }, { id: 'client-2', body: 'Deux' }] }] };
  const saved = { conversations: [{ id: 'C-1', messages: [{ id: 'server-1', body: 'Un' }] }] };
  assert.deepEqual(rebaseAfterSave(sent, local, saved).conversations[0].messages.map((m) => m.id), ['server-1', 'client-2']);
});

test('a save with no edit in flight returns the server copy unchanged', () => {
  const sent = { tickets: [{ id: 'INC-1', title: 'A' }] };
  const saved = { tickets: [{ id: 'INC-1', title: 'A', updatedBy: 'user_a' }] };
  assert.equal(rebaseAfterSave(sent, structuredClone(sent), saved), saved);
});
