import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGE_TTL_OPTIONS, isExpiredMessage, remainingLabel } from '../src/lib/ephemeral.ts';
import { isConvertibleSupportMessage } from '../src/lib/message-conversion.ts';

const now = Date.parse('2026-11-08T10:00:00.000Z');
const msg = (extra = {}) => ({ id: 'm', author: 'user_a', body: 'Texte', time: '', ...extra });

test('lifetimes go from 30 seconds to 30 days, plus permanent', () => {
  const seconds = MESSAGE_TTL_OPTIONS.map((o) => o.seconds).filter(Boolean);
  assert.equal(Math.min(...seconds), 30);
  assert.equal(Math.max(...seconds), 30 * 24 * 3600);
});

test('a message is hidden as soon as it expires, even before the server purge', () => {
  assert.equal(isExpiredMessage(msg(), now), false);
  assert.equal(isExpiredMessage(msg({ expiresAt: '2026-11-08T10:00:30.000Z' }), now), false);
  assert.equal(isExpiredMessage(msg({ expiresAt: '2026-11-08T09:59:59.000Z' }), now), true);
  assert.equal(isExpiredMessage(msg({ expired: true, body: '' }), now), true);
});

test('the countdown is readable at every scale', () => {
  assert.equal(remainingLabel(msg({ expiresAt: '2026-11-08T10:00:30.000Z' }), now), '30 s');
  assert.equal(remainingLabel(msg({ expiresAt: '2026-11-08T10:04:10.000Z' }), now), '4 min 10 s');
  assert.equal(remainingLabel(msg({ expiresAt: '2026-11-08T13:05:00.000Z' }), now), '3 h 05');
  assert.equal(remainingLabel(msg({ expiresAt: '2026-11-15T09:00:00.000Z' }), now), '6 j 23 h');
  assert.equal(remainingLabel(msg(), now), null);
});

test('an expired support message can no longer be converted into an incident', () => {
  assert.equal(isConvertibleSupportMessage(msg({ expired: true, body: '' })), false);
  assert.equal(isConvertibleSupportMessage(msg()), true);
});
