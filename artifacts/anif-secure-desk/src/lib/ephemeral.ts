import type { Message } from './types';

/** Lifetimes offered to the sender (cahier des charges : de 30 secondes à 30 jours). */
export const MESSAGE_TTL_OPTIONS: ReadonlyArray<{ seconds: number; label: string }> = [
  { seconds: 0, label: 'Permanent' },
  { seconds: 30, label: '30 secondes' },
  { seconds: 5 * 60, label: '5 minutes' },
  { seconds: 60 * 60, label: '1 heure' },
  { seconds: 24 * 60 * 60, label: '24 heures' },
  { seconds: 7 * 24 * 60 * 60, label: '7 jours' },
  { seconds: 30 * 24 * 60 * 60, label: '30 jours' },
];

/** Expired on the server, or past its expiry on this screen before the next purge. */
export function isExpiredMessage(message: Message, now: number): boolean {
  if (message.expired) return true;
  if (!message.expiresAt) return false;
  const expiry = Date.parse(message.expiresAt);
  return Number.isFinite(expiry) && expiry <= now;
}

/** Short countdown such as « 4 min 10 s », « 3 h 05 », « 6 j 23 h ». */
export function remainingLabel(message: Message, now: number): string | null {
  if (!message.expiresAt || message.expired) return null;
  const ms = Date.parse(message.expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, '0')}`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}
