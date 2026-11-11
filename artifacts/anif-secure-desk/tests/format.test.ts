import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtMinutes } from '../src/lib/domain';

test('SLA durations stay readable: whole hours, then minutes, never decimals', () => {
  assert.deepEqual([15, 60, 120, 685, 2880].map(fmtMinutes), ['15 min', '1 h', '2 h', '11 h 25', '48 h']);
});
