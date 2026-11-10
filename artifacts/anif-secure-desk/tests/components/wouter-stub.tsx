/** Stand-in for wouter in screen tests: the location is a value tests can set and read. */
import { createElement, type ReactNode } from 'react';

export const router = { path: '/', search: '', history: [] as string[] };

export function useLocation(): [string, (to: string, options?: { replace?: boolean }) => void] {
  return [router.path, (to) => { router.history.push(to); const [path, search = ''] = to.split('?'); router.path = path!; router.search = search; }];
}
export const useSearch = () => router.search;
export function Link({ href, children, ...rest }: { href: string; children?: ReactNode } & Record<string, unknown>) {
  return createElement('a', { href, ...rest }, children);
}
