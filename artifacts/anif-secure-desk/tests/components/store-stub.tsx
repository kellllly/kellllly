/**
 * Stand-in for @/lib/store in screen tests: a plain React state holding the
 * workspace, without the shared API, Clerk or polling. Tests read what the
 * screen wrote through `current` and `logs`.
 */
import { createContext, createElement, useContext, useState, type ReactNode } from 'react';
import { baseStore } from '@/lib/seed';
import type { Store, Ticket } from '@/lib/types';

type Ctx = { store: Store; setStore: (next: Store | ((s: Store) => Store)) => void; log: (action: string, scope: string) => void };
const StoreContext = createContext<Ctx | null>(null);

export const current: { store: Store | null } = { store: null };
export const logs: Array<{ action: string; scope: string }> = [];
/** Clock read by useNow: tests move it to cross SLA thresholds. */
export const clock = { now: Date.parse('2026-11-10T08:00:00.000Z') };

export function testStore(tickets: Ticket[] = []): Store {
  return { ...baseStore(), tickets, conversations: [], seeded: true } as Store;
}

export function TestStoreProvider({ initial, children }: { initial: Store; children: ReactNode }) {
  const [store, setState] = useState(initial);
  current.store = store;
  const setStore: Ctx['setStore'] = (next) => setState((previous) => {
    const value = typeof next === 'function' ? next(previous) : next;
    current.store = value;
    return value;
  });
  const log = (action: string, scope: string) => { logs.push({ action, scope }); };
  return createElement(StoreContext.Provider, { value: { store, setStore, log } }, children);
}

export function useStore() {
  const value = useContext(StoreContext);
  if (!value) throw new Error('TestStoreProvider manquant');
  return value;
}

export const useNow = () => clock.now;
