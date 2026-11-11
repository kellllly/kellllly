import test from 'node:test';
import assert from 'node:assert/strict';
import { runShortcut } from '../src/lib/shortcuts';

const press = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}, code = `Key${key.toUpperCase()}`) => {
  let prevented = false;
  return { event: { key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods, preventDefault: () => { prevented = true; } }, prevented: () => prevented };
};
const run = (p: ReturnType<typeof press>, role = 'N3', hasSearch = true) => {
  const visited: string[] = []; let focused = 0;
  const done = runShortcut(p.event, role, href => visited.push(href), () => { focused++; return hasSearch; });
  return { done, visited, focused, prevented: p.prevented() };
};

test('Alt+Maj shortcuts navigate and stop the browser default', () => {
  assert.deepEqual(run(press('T', { altKey: true, shiftKey: true })), { done: true, visited: ['/tickets?new=1'], focused: 0, prevented: true });
  assert.deepEqual(run(press('M', { altKey: true, shiftKey: true })).visited, ['/messages']);
  assert.deepEqual(run(press('†', { altKey: true, shiftKey: true }, 'KeyD')).visited, ['/'], 'macOS Option character: physical key used');
});

test('Ctrl/⌘+K focuses the page search, and lets the browser have it when there is none', () => {
  assert.deepEqual(run(press('k', { ctrlKey: true })), { done: true, visited: [], focused: 1, prevented: true });
  assert.equal(run(press('k', { metaKey: true })).focused, 1);
  assert.deepEqual(run(press('k', { ctrlKey: true }), 'N3', false), { done: false, visited: [], focused: 1, prevented: false });
});

test('no shortcut for an auditor ticket, plain typing or other combinations', () => {
  assert.equal(run(press('T', { altKey: true, shiftKey: true }), 'N5').done, false);
  assert.equal(run(press('t')).done, false);
  assert.equal(run(press('T', { ctrlKey: true, altKey: true, shiftKey: true })).done, false);
  assert.equal(run(press('k', { ctrlKey: true, shiftKey: true })).done, false);
  assert.equal(run(press('X', { altKey: true, shiftKey: true })).done, false);
});
