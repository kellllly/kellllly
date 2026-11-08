import test from 'node:test';
import assert from 'node:assert/strict';
import { isNetworkFailure, offlineMessage } from '../src/lib/offline.ts';

test('a failed fetch or an unreachable gateway is a network failure', () => {
  assert.equal(isNetworkFailure(new TypeError('Failed to fetch'), true), true);
  assert.equal(isNetworkFailure(new TypeError('NetworkError when attempting to fetch resource.'), true), true);
  assert.equal(isNetworkFailure(new TypeError('Load failed'), true), true);
  assert.equal(isNetworkFailure({ status: 502 }, true), true);
  assert.equal(isNetworkFailure({ status: 504 }, true), true);
  assert.equal(isNetworkFailure(new Error('anything'), false), true, 'the browser says it is offline');
});

test('a refusal by the API is not a network failure', () => {
  for (const status of [400, 401, 403, 409, 422, 500, 503]) assert.equal(isNetworkFailure({ status }, true), false, String(status));
  assert.equal(isNetworkFailure(new TypeError('Cannot read properties of undefined'), true), false);
  assert.equal(isNetworkFailure(null, true), false);
});

test('the banner gives the duration of the outage', () => {
  const now = Date.parse('2026-11-08T10:05:00.000Z');
  assert.match(offlineMessage('2026-11-08T10:04:40.000Z', now), /moins d’une minute/);
  assert.match(offlineMessage('2026-11-08T10:00:00.000Z', now), /5 min/);
});
