import type { PresenceStatus, Store } from './types';

/** Statuses an agent can choose; the server accepts the same three ids. */
export const PRESENCE_OPTIONS: readonly { id: PresenceStatus; label: string; dot: string }[] = [
  { id: 'disponible', label: 'Disponible', dot: 'bg-[#4f9d80]' },
  { id: 'occupe', label: 'Ne pas déranger', dot: 'bg-[#c88e43]' },
  { id: 'absent', label: 'Hors poste', dot: 'bg-[#9aa5ad]' },
];

/** The chosen status of an agent, or undefined when they never set one (shown as nothing). */
export const presenceOf = (store: Pick<Store, 'presence'>, userId: string) =>
  PRESENCE_OPTIONS.find(option => option.id === store.presence?.[userId]?.status);

/** Keeps only well-formed entries from the server. */
export function parsePresence(raw: unknown): NonNullable<Store['presence']> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).flatMap(([id, value]) => {
    const { status, at } = (value ?? {}) as Record<string, unknown>;
    return PRESENCE_OPTIONS.some(option => option.id === status) && typeof at === 'string' ? [[id, { status: status as PresenceStatus, at }]] : [];
  }));
}
