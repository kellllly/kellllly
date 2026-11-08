import type { Conversation } from './types';

/** Durations offered for a temporary channel (server bounds: 1 h to 30 days). */
export const TEMPORARY_DURATIONS: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 1, label: '1 heure' },
  { hours: 24, label: '24 heures' },
  { hours: 72, label: '3 jours' },
  { hours: 7 * 24, label: '7 jours' },
  { hours: 30 * 24, label: '30 jours' },
];

/** A temporary channel is read-only once its end date has passed. */
export function isClosedChannel(conversation: Pick<Conversation, 'kind' | 'expiresAt'>, now: number): boolean {
  if (conversation.kind !== 'Temporaire' || !conversation.expiresAt) return false;
  const end = Date.parse(conversation.expiresAt);
  return Number.isFinite(end) && end <= now;
}
