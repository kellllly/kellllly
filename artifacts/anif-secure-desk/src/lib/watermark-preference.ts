import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'anif-watermark-enabled';
const CHANGE_EVENT = 'anif-watermark-preference-change';
let fallbackValue: boolean | null = null;

function getSnapshot(): boolean {
  if (fallbackValue !== null) return fallbackValue;
  if (typeof window === 'undefined') return true;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved !== 'false';
  } catch {
    // Keep the in-memory setting usable when browser storage is unavailable.
  }
  return true;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    fallbackValue = null;
    listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setWatermarkEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') {
    fallbackValue = enabled;
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
    fallbackValue = null;
  } catch {
    // The preference still applies for this page session.
    fallbackValue = enabled;
  }
  window.dispatchEvent(new window.Event(CHANGE_EVENT));
}

export function useWatermarkEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
