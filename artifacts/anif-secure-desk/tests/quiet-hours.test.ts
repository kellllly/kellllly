import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUIET_HOURS, isQuietTime, parseQuietHours } from '../src/lib/quiet-hours';

// 21:00 UTC is 22:00 in Libreville (WAT, UTC+1).
const wat = (hhmm: string) => Date.parse(`2026-11-12T${hhmm}:00Z`) - 60 * 60_000;

test('a window crossing midnight is quiet late in the evening and early in the morning, in Libreville time', () => {
  const night = { enabled: true, start: '18:00', end: '07:30' };
  assert.equal(isQuietTime(night, wat('22:00')), true);
  assert.equal(isQuietTime(night, wat('00:30')), true);
  assert.equal(isQuietTime(night, wat('07:29')), true);
  assert.equal(isQuietTime(night, wat('07:30')), false, 'the end is excluded');
  assert.equal(isQuietTime(night, wat('12:00')), false);
  assert.equal(isQuietTime(night, wat('18:00')), true, 'the start is included');
});

test('a daytime window, a disabled window and equal bounds', () => {
  const lunch = { enabled: true, start: '12:00', end: '14:00' };
  assert.equal(isQuietTime(lunch, wat('13:00')), true);
  assert.equal(isQuietTime(lunch, wat('15:00')), false);
  assert.equal(isQuietTime({ ...lunch, enabled: false }, wat('13:00')), false);
  assert.equal(isQuietTime({ enabled: true, start: '09:00', end: '09:00' }, wat('09:00')), false);
});

test('stored values are validated; anything malformed falls back to the default (off)', () => {
  assert.deepEqual(parseQuietHours({ enabled: true, start: '21:15', end: '06:00' }), { enabled: true, start: '21:15', end: '06:00' });
  for (const bad of [null, 'oui', { enabled: 'yes', start: '21:00', end: '06:00' }, { enabled: true, start: '25:00', end: '06:00' }, { enabled: true, start: '21:00' }])
    assert.deepEqual(parseQuietHours(bad), DEFAULT_QUIET_HOURS);
  assert.equal(DEFAULT_QUIET_HOURS.enabled, false);
});
