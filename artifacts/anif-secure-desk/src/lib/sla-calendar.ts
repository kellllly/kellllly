import type { SlaCalendar, SlaPause } from './types';

export type BusinessSlaProgress = {
  state: 'ok' | 'warning' | 'breach' | 'met';
  fraction: number;
  remainingMs: number;
};

export const DEFAULT_SLA_CALENDAR: SlaCalendar = {
  timezone: 'Africa/Libreville',
  workingDays: [1, 2, 3, 4, 5],
  startTime: '07:00',
  endTime: '19:00',
  holidays: [],
};

const WAT_OFFSET_MS = 60 * 60_000;
const MINUTE_MS = 60_000;
const watPartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Libreville',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function timestamp(value: string | number | Date): number {
  const result = value instanceof Date ? value.getTime()
    : typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(result)) throw new RangeError('Horodatage SLA invalide.');
  return result;
}

function partsAt(value: number): Record<string, string> {
  return Object.fromEntries(watPartsFormatter.formatToParts(value).map(({ type, value: part }) => [type, part]));
}

function localDay(value: number): string {
  const parts = partsAt(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dayParts(day: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new RangeError('Date de calendrier invalide.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== date) {
    throw new RangeError('Date de calendrier invalide.');
  }
  return [year, month, date];
}

function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    dayParts(value);
    return true;
  } catch {
    return false;
  }
}

export function parseSlaCalendar(value: unknown): SlaCalendar {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RangeError('Calendrier SLA invalide.');
  }
  const input = value as Record<string, unknown>;
  const holidays = input.holidays;
  if (
    input.timezone !== DEFAULT_SLA_CALENDAR.timezone
    || input.startTime !== DEFAULT_SLA_CALENDAR.startTime
    || input.endTime !== DEFAULT_SLA_CALENDAR.endTime
    || !Array.isArray(input.workingDays)
    || input.workingDays.length !== DEFAULT_SLA_CALENDAR.workingDays.length
    || input.workingDays.some((day, index) => day !== DEFAULT_SLA_CALENDAR.workingDays[index])
    || !Array.isArray(holidays)
    || holidays.length > 366
    || holidays.some((holiday) => !isValidCalendarDate(holiday))
    || new Set(holidays).size !== holidays.length
  ) {
    throw new RangeError('Le calendrier doit être du lundi au vendredi, de 07 h à 19 h, avec au plus 366 jours fériés uniques.');
  }
  return { ...DEFAULT_SLA_CALENDAR, holidays: [...holidays].sort() as string[] };
}

export function normalizeSlaCalendar(value: unknown): SlaCalendar {
  try {
    return parseSlaCalendar(value);
  } catch {
    return { ...DEFAULT_SLA_CALENDAR, holidays: [] };
  }
}

export function parseHolidayDates(input: string): string[] {
  const values = input.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
  if (values.length > 366 || values.some((value) => !isValidCalendarDate(value))) {
    throw new RangeError('Saisissez au plus 366 dates réelles au format AAAA-MM-JJ.');
  }
  return [...new Set(values)].sort();
}

function isBusinessDay(day: string, calendar: SlaCalendar): boolean {
  const [year, month, date] = dayParts(day);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  return calendar.workingDays.includes(weekday) && !calendar.holidays.includes(day);
}

function businessWindow(day: string, calendar: SlaCalendar): { start: number; end: number } | null {
  if (!isBusinessDay(day, calendar)) return null;
  const [year, month, date] = dayParts(day);
  const start = Date.UTC(year, month - 1, date, 7) - WAT_OFFSET_MS;
  const end = Date.UTC(year, month - 1, date, 19) - WAT_OFFSET_MS;
  return { start, end };
}

function nextDay(day: string): string {
  const [year, month, date] = dayParts(day);
  return new Date(Date.UTC(year, month - 1, date + 1)).toISOString().slice(0, 10);
}

function nextBusinessWindowStart(day: string, calendar: SlaCalendar): number {
  let candidate = nextDay(day);
  for (let count = 0; count < 3700; count += 1) {
    const window = businessWindow(candidate, calendar);
    if (window) return window.start;
    candidate = nextDay(candidate);
  }
  throw new RangeError('Aucun jour ouvré disponible dans le calendrier.');
}

export function addBusinessMinutes(
  startAt: string | number | Date,
  minutes: number,
  calendar = DEFAULT_SLA_CALENDAR,
): string {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError('Le délai SLA doit être positif.');
  let cursor = timestamp(startAt);
  let remaining = minutes * MINUTE_MS;
  let guard = 0;
  while (remaining > 0) {
    guard += 1;
    if (guard > 4000) throw new RangeError('Le calcul de l’échéance SLA dépasse la plage permise.');
    const day = localDay(cursor);
    const window = businessWindow(day, calendar);
    if (!window) {
      cursor = nextBusinessWindowStart(day, calendar);
      continue;
    }
    if (cursor < window.start) cursor = window.start;
    if (cursor >= window.end) {
      cursor = nextBusinessWindowStart(day, calendar);
      continue;
    }
    const consumed = Math.min(remaining, window.end - cursor);
    cursor += consumed;
    remaining -= consumed;
  }
  return new Date(cursor).toISOString();
}

export function businessMinutesBetween(
  startAt: string | number | Date,
  endAt: string | number | Date,
  calendar = DEFAULT_SLA_CALENDAR,
): number {
  const start = timestamp(startAt);
  const end = timestamp(endAt);
  if (end <= start) return 0;
  let day = localDay(start);
  const lastDay = localDay(end);
  let total = 0;
  for (let guard = 0; day <= lastDay && guard < 3700; guard += 1) {
    const window = businessWindow(day, calendar);
    if (window) {
      const overlap = Math.max(0, Math.min(end, window.end) - Math.max(start, window.start));
      total += overlap;
    }
    day = nextDay(day);
  }
  return total / MINUTE_MS;
}

export function pausedBusinessMinutesBetween(
  startAt: string | number | Date,
  endAt: string | number | Date,
  pauses: readonly SlaPause[] = [],
  calendar = DEFAULT_SLA_CALENDAR,
): number {
  const start = timestamp(startAt);
  const end = timestamp(endAt);
  if (end <= start) return 0;
  let total = 0;
  for (const pause of pauses) {
    const pauseStart = timestamp(pause.startedAt);
    const pauseEnd = pause.endedAt ? timestamp(pause.endedAt) : end;
    const overlapStart = Math.max(start, pauseStart);
    const overlapEnd = Math.min(end, pauseEnd);
    if (overlapEnd > overlapStart) total += businessMinutesBetween(overlapStart, overlapEnd, calendar);
  }
  return total;
}

function pausedUntil(
  openedAt: string,
  phaseEnd: string | null,
  pauses: readonly SlaPause[],
  now: number,
  calendar: SlaCalendar,
): number {
  const end = phaseEnd ? timestamp(phaseEnd) : now;
  return pausedBusinessMinutesBetween(openedAt, end, pauses, calendar);
}

export function getBusinessDeadlines(
  openedAt: string,
  policy: { acknowledgeMinutes: number; resolveMinutes: number },
  calendar: SlaCalendar,
  pauses: readonly SlaPause[] = [],
  now = Date.now(),
  acknowledgedAt: string | null = null,
  resolvedAt: string | null = null,
): { acknowledgeBy: string; resolveBy: string } {
  const ackPause = pausedUntil(openedAt, acknowledgedAt, pauses, now, calendar);
  const resolvePause = pausedUntil(openedAt, resolvedAt, pauses, now, calendar);
  return {
    acknowledgeBy: addBusinessMinutes(openedAt, policy.acknowledgeMinutes + ackPause, calendar),
    resolveBy: addBusinessMinutes(openedAt, policy.resolveMinutes + resolvePause, calendar),
  };
}

export function businessSlaProgress(
  openedAt: string,
  completedAt: string | null,
  now: number,
  targetMinutes: number,
  calendar: SlaCalendar,
  pauses: readonly SlaPause[] = [],
): BusinessSlaProgress {
  if (!Number.isFinite(targetMinutes) || targetMinutes <= 0) throw new RangeError('La cible SLA doit être positive.');
  const opened = timestamp(openedAt);
  const rawEvaluation = completedAt ? timestamp(completedAt) : timestamp(now);
  if (completedAt && rawEvaluation < opened) {
    return { state: 'breach', fraction: 1, remainingMs: -MINUTE_MS };
  }
  const evaluatedAt = Math.max(opened, rawEvaluation);
  const elapsed = Math.max(0, businessMinutesBetween(opened, evaluatedAt, calendar)
    - pausedBusinessMinutesBetween(opened, evaluatedAt, pauses, calendar));
  const fraction = Math.min(1, elapsed / targetMinutes);
  const remainingMs = (targetMinutes - elapsed) * MINUTE_MS;
  const state = completedAt
    ? elapsed <= targetMinutes ? 'met' : 'breach'
    : elapsed >= targetMinutes ? 'breach' : fraction >= 0.8 ? 'warning' : 'ok';
  return { state, fraction, remainingMs };
}
