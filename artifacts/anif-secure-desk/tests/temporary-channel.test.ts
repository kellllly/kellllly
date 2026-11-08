import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPORARY_DURATIONS, isClosedChannel } from '../src/lib/temporary-channel.ts';

const now = Date.parse('2026-11-08T10:00:00.000Z');

test('durations stay inside the server bounds (1 h to 30 days)', () => {
  const hours = TEMPORARY_DURATIONS.map((d) => d.hours);
  assert.equal(Math.min(...hours), 1);
  assert.equal(Math.max(...hours), 720);
});

test('a temporary channel closes at its end date', () => {
  assert.equal(isClosedChannel({ kind: 'Temporaire', expiresAt: '2026-11-08T09:59:59.000Z' }, now), true);
  assert.equal(isClosedChannel({ kind: 'Temporaire', expiresAt: '2026-11-08T10:00:00.000Z' }, now), true);
  assert.equal(isClosedChannel({ kind: 'Temporaire', expiresAt: '2026-11-08T10:00:01.000Z' }, now), false);
});

test('other channels and channels without an end date never close', () => {
  assert.equal(isClosedChannel({ kind: 'Enquête', expiresAt: '2020-01-01T00:00:00.000Z' }, now), false);
  assert.equal(isClosedChannel({ kind: 'Temporaire' }, now), false);
  assert.equal(isClosedChannel({ kind: 'Temporaire', expiresAt: 'invalide' }, now), false);
});
