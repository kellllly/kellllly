import { useSyncExternalStore } from 'react';

// The interface is sized in px, so the whole page is zoomed rather than the root font size.
export const TEXT_SIZE_OPTIONS = [
  { id: 'standard', label: 'Standard', zoom: 1 },
  { id: 'grand', label: 'Grand', zoom: 1.15 },
  { id: 'tres-grand', label: 'Très grand', zoom: 1.3 },
] as const;

export type TextSizeId = (typeof TEXT_SIZE_OPTIONS)[number]['id'];

const STORAGE_KEY = 'anif-text-size-v1';
const CHANGE_EVENT = 'anif-text-size-change';
let current: TextSizeId = 'standard';

const isTextSize = (value: unknown): value is TextSizeId => TEXT_SIZE_OPTIONS.some(option => option.id === value);

function apply(size: TextSizeId): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.textSize = size;
}

export function setTextSizePreference(size: TextSizeId): void {
  current = size;
  try { window.localStorage.setItem(STORAGE_KEY, size); } catch { /* blocked storage: kept for this page session */ }
  apply(size);
  window.dispatchEvent(new window.Event(CHANGE_EVENT));
}

const subscribe = (listener: () => void) => {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
};

export const useTextSizePreference = (): TextSizeId => useSyncExternalStore(subscribe, () => current, () => 'standard');

if (typeof window !== 'undefined') {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isTextSize(saved)) current = saved;
  } catch { /* default size */ }
  apply(current);
}
