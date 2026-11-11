import { useSyncExternalStore } from 'react';

export const APP_FONT_OPTIONS = [
  { id: 'plus-jakarta', label: 'Plus Jakarta Sans', family: '"Plus Jakarta Sans", sans-serif' },
  { id: 'dm-sans', label: 'DM Sans', family: '"DM Sans", sans-serif' },
  { id: 'inter', label: 'Inter', family: 'Inter, sans-serif' },
] as const;

export type AppFontId = (typeof APP_FONT_OPTIONS)[number]['id'];

const STORAGE_KEY = 'anif-app-font-v1';
const CHANGE_EVENT = 'anif-app-font-change';
const DEFAULT_FONT: AppFontId = 'plus-jakarta';
let fallbackFont: AppFontId | null = null;

function isAppFont(value: string | null): value is AppFontId {
  return APP_FONT_OPTIONS.some((font) => font.id === value);
}

export function getAppFontPreference(): AppFontId {
  if (fallbackFont) return fallbackFont;
  if (typeof window === 'undefined') return DEFAULT_FONT;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return isAppFont(saved) ? saved : DEFAULT_FONT;
  } catch {
    return DEFAULT_FONT;
  }
}

export function applyAppFontPreference(font: AppFontId): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.appFont = font;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    fallbackFont = null;
    applyAppFontPreference(getAppFontPreference());
    listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setAppFontPreference(font: AppFontId): void {
  fallbackFont = font;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, font);
      fallbackFont = null;
    } catch {
      // Keep the selection for this page session if browser storage is blocked.
    }
    applyAppFontPreference(font);
    window.dispatchEvent(new window.Event(CHANGE_EVENT));
  }
}

export function useAppFontPreference(): AppFontId {
  return useSyncExternalStore(subscribe, getAppFontPreference, () => DEFAULT_FONT);
}

if (typeof document !== 'undefined') {
  applyAppFontPreference(getAppFontPreference());
}
