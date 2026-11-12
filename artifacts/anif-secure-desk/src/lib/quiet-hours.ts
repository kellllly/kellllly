import { useSyncExternalStore } from 'react';

/** Quiet hours: during this daily window the bell only signals SLA breaches. Times are Libreville time (WAT). */
export type QuietHours = { enabled: boolean; start: string; end: string };

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: false, start: '18:00', end: '07:30' };
const STORAGE_KEY = 'anif-quiet-hours-v1';
const CHANGE_EVENT = 'anif-quiet-hours-change';
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;
const WAT_OFFSET_MINUTES = 60; // UTC+1 all year, no daylight saving.

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Reads a stored value; anything malformed falls back to the default. */
export function parseQuietHours(raw: unknown): QuietHours {
  if (!raw || typeof raw !== 'object') return DEFAULT_QUIET_HOURS;
  const { enabled, start, end } = raw as Record<string, unknown>;
  if (typeof enabled !== 'boolean' || typeof start !== 'string' || typeof end !== 'string' || !TIME.test(start) || !TIME.test(end)) return DEFAULT_QUIET_HOURS;
  return { enabled, start, end };
}

/** True inside the window; a window may cross midnight (18:00 → 07:30). Equal bounds mean no window. */
export function isQuietTime(quiet: QuietHours, now: number): boolean {
  if (!quiet.enabled || quiet.start === quiet.end) return false;
  const minute = Math.floor(((now / 60_000 + WAT_OFFSET_MINUTES) % 1440 + 1440) % 1440);
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

let current: QuietHours = DEFAULT_QUIET_HOURS;

export function setQuietHours(quiet: QuietHours): void {
  current = parseQuietHours(quiet);
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* blocked storage: kept for this page session */ }
  window.dispatchEvent(new window.Event(CHANGE_EVENT));
}

const subscribe = (listener: () => void) => {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
};

export const useQuietHours = (): QuietHours => useSyncExternalStore(subscribe, () => current, () => DEFAULT_QUIET_HOURS);

if (typeof window !== 'undefined') {
  try { current = parseQuietHours(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')); } catch { /* default */ }
}
