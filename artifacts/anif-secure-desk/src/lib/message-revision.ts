import type { Message } from './types';

/** Same window as the API (CDC-ANIF-MSG § 4.1); the server has the last word. */
export const MESSAGE_EDIT_WINDOW_MS = 5 * 60_000;

export function canEditMessage(message: Message, now: number): boolean {
  const sent = Date.parse(message.at ?? '');
  return !message.deleted && Number.isFinite(sent) && now - sent <= MESSAGE_EDIT_WINDOW_MS;
}

/** Readers whose last read message is this one or a later one (those who read least first). */
export function readersOf(message: Message, readBy: Record<string, string> | undefined): string[] {
  const sent = Date.parse(message.at ?? '');
  if (!readBy || !Number.isFinite(sent)) return [];
  return Object.entries(readBy).filter(([, at]) => Date.parse(at) >= sent).sort(([, a], [, b]) => Date.parse(a) - Date.parse(b)).map(([reader]) => reader);
}
