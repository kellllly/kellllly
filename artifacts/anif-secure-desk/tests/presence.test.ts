import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePresence, presenceOf } from '../src/lib/presence';
import { migrate } from '../src/lib/seed';

test('presence from the server is kept only when well formed', () => {
  const raw = { user_a: { status: 'occupe', at: '2026-11-12T10:00:00Z' }, user_b: { status: 'invisible', at: '2026-11-12T10:00:00Z' }, user_c: { status: 'absent' }, user_d: null };
  assert.deepEqual(parsePresence(raw), { user_a: { status: 'occupe', at: '2026-11-12T10:00:00Z' } });
  assert.deepEqual(parsePresence(['user_a']), {});
  assert.deepEqual(migrate({ presence: raw }).presence, { user_a: { status: 'occupe', at: '2026-11-12T10:00:00Z' } });
  assert.equal('presence' in migrate(null), false, 'no presence before the server sends any');
});

test('the status of an agent, or nothing when they never chose one', () => {
  const store = { presence: { user_a: { status: 'absent' as const, at: '2026-11-12T10:00:00Z' } } };
  assert.equal(presenceOf(store, 'user_a')?.label, 'Hors poste');
  assert.equal(presenceOf(store, 'user_z'), undefined);
  assert.equal(presenceOf({}, 'user_a'), undefined);
});
