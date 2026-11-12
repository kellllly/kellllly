import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditMessage, MESSAGE_EDIT_WINDOW_MS, readersOf } from '../src/lib/message-revision';
import { normalizeConversation } from '../src/lib/seed';
import type { Message } from '../src/lib/types';

const m = (at?: string): Message => ({ id: 'm', author: 'user_me', body: 'Consigne', time: '', at });

test('a reader has read a message when their last read message is that one or a later one', () => {
  const readBy = { user_late: '2026-11-12T10:05:00Z', user_on_time: '2026-11-12T10:00:00Z', user_before: '2026-11-12T09:59:00Z' };
  assert.deepEqual(readersOf(m('2026-11-12T10:00:00Z'), readBy), ['user_on_time', 'user_late']);
  assert.deepEqual(readersOf(m('2026-11-12T10:10:00Z'), readBy), []);
  assert.deepEqual(readersOf(m(), readBy), [], 'a message without a time has no receipt');
  assert.deepEqual(readersOf(m('2026-11-12T10:00:00Z'), undefined), []);
});

test('receipts from the server survive normalization; malformed ones are dropped', () => {
  const base = { id: 'C-1', title: 'Équipe', kind: 'Équipe', classification: 'Interne', participants: [], readCount: 0, messages: [] };
  assert.deepEqual(normalizeConversation({ ...base, readBy: { user_a: '2026-11-12T10:00:00Z', user_b: 42 } }).readBy, { user_a: '2026-11-12T10:00:00Z' });
  assert.equal('readBy' in normalizeConversation({ ...base, readBy: ['user_a'] }), false);
  assert.equal('readBy' in normalizeConversation(base), false);
});

test('a message can be corrected by its author for 5 minutes, never once deleted', () => {
  const sent = Date.parse('2026-11-12T10:00:00Z');
  assert.equal(canEditMessage(m('2026-11-12T10:00:00Z'), sent + MESSAGE_EDIT_WINDOW_MS), true);
  assert.equal(canEditMessage(m('2026-11-12T10:00:00Z'), sent + MESSAGE_EDIT_WINDOW_MS + 1), false);
  assert.equal(canEditMessage({ ...m('2026-11-12T10:00:00Z'), deleted: true }, sent), false);
  assert.equal(canEditMessage(m(), sent), false, 'without a send time, nothing to compare');
});
