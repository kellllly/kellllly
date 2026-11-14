import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addBusinessMinutes,
  businessSlaProgress,
  DEFAULT_SLA_CALENDAR,
  getBusinessDeadlines,
  parseHolidayDates,
  parseSlaCalendar,
} from '../src/lib/sla-calendar.ts';

const policy = { acknowledgeMinutes: 15, resolveMinutes: 60 };

test('the Libreville work calendar rolls Friday deadlines past the weekend', () => {
  const opened = '2026-11-06T17:55:00.000Z'; // Friday, 18:55 WAT
  assert.equal(addBusinessMinutes(opened, 15), '2026-11-09T06:10:00.000Z');
});

test('configured holidays are skipped and validated as real ISO dates', () => {
  const calendar = parseSlaCalendar({ ...DEFAULT_SLA_CALENDAR, holidays: ['2026-11-09'] });
  assert.equal(addBusinessMinutes('2026-11-06T17:55:00.000Z', 15, calendar), '2026-11-10T06:10:00.000Z');
  assert.deepEqual(parseHolidayDates('2026-12-25, 2026-01-01'), ['2026-01-01', '2026-12-25']);
  assert.throws(() => parseHolidayDates('2026-02-30'), /dates réelles/);
});

test('waiting time pauses both the due date and the displayed remaining time', () => {
  const opened = '2026-11-09T06:00:00.000Z'; // Monday, 07:00 WAT
  const pauses = [{ startedAt: '2026-11-09T06:10:00.000Z', endedAt: '2026-11-09T06:20:00.000Z' }];
  const deadlines = getBusinessDeadlines(opened, policy, DEFAULT_SLA_CALENDAR, pauses, Date.parse('2026-11-09T06:20:00.000Z'));
  assert.equal(deadlines.acknowledgeBy, '2026-11-09T06:25:00.000Z');
  const progress = businessSlaProgress(opened, null, Date.parse('2026-11-09T06:20:00.000Z'), 15, DEFAULT_SLA_CALENDAR, pauses);
  assert.equal(progress.fraction, 10 / 15);
  assert.equal(progress.remainingMs, 5 * 60_000);
});
