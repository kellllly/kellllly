import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionNotifications, mentionOf, splitMentions } from '../src/lib/mentions';
import type { Conversation, Message } from '../src/lib/types';

const names = ['user_me', 'Nadia Moussavou'];

test('a mention is a whole @token, ignoring case and accents, never inside an e-mail address', () => {
  assert.equal(mentionOf('Merci @nadia moussavou pour le point', names), 'me');
  assert.equal(mentionOf('@NADIA MOUSSAVOU, tu valides ?', names), 'me');
  assert.equal(mentionOf('cc @user_me', names), 'me');
  assert.equal(mentionOf('Réunion pour @Tous demain', names), 'all');
  assert.equal(mentionOf('@tousse ou nadia@anif.ga', names), null);
  assert.equal(mentionOf('@Nadia Moussavoux', names), null, 'a longer name is someone else');
  assert.equal(mentionOf('@Nadia Moussavou et @tous', names), 'me', 'a personal mention wins');
  assert.equal(mentionOf('@ tous', []), null);
});

test('mention notifications skip my own, system, deleted and expired messages', () => {
  const m = (id: string, author: string, body: string, extra: Partial<Message> = {}): Message => ({ id, author, body, time: '', at: `2026-11-12T10:0${id.length}:00Z`, ...extra });
  const conversation: Conversation = { id: 'C-1', title: 'Équipe réseau', kind: 'Équipe', classification: 'Interne', participants: [], readCount: 0, messages: [
    m('a', 'user_other', '@Nadia Moussavou, tu peux regarder ?'),
    m('bb', 'user_other', 'Pause à 15 h @tous'),
    m('ccc', 'user_me', '@tous je reviens'),
    m('dddd', 'Direction', '@tous', { system: true }),
    m('eeeee', 'user_other', '', { deleted: true }),
    m('ffffff', 'user_other', '@tous', { expired: true }),
    m('g', 'user_other', 'Rien pour toi'),
  ] };
  const list = mentionNotifications([conversation], 'user_me', names);
  assert.deepEqual(list.map(n => [n.id, n.title]), [['mention:a', 'Vous êtes mentionné · Équipe réseau'], ['mention:bb', 'Message à tous · Équipe réseau']]);
  assert.deepEqual([list[0]!.conversationId, list[0]!.messageId], ['C-1', 'a']);
});

test('mentions of known names are split out for highlighting', () => {
  assert.deepEqual(splitMentions('Bonjour @Nadia Moussavou et @tous.', ['Nadia Moussavou']), [
    { text: 'Bonjour ', mention: false }, { text: '@Nadia Moussavou', mention: true }, { text: ' et ', mention: false }, { text: '@tous', mention: true }, { text: '.', mention: false },
  ]);
  assert.deepEqual(splitMentions('mail a@tous.ga', []), [{ text: 'mail a@tous.ga', mention: false }]);
});
