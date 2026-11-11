import test from 'node:test';
import assert from 'node:assert/strict';
import { findKedbSuggestionsForDraft } from '../src/lib/diagnostic-assistant';
import type { KedbArticle } from '../src/lib/types';

const article = (id: string, fields: Partial<KedbArticle>): KedbArticle => ({ id, title: '', symptom: '', rootCause: '', resolution: '', ticketId: 'INC-1', category: 'Applications', createdAt: '2026-11-01T00:00:00Z', author: 'user_n3', ...fields });
const kedb = [
  article('KB-1', { title: 'Certificat SMTP expiré', symptom: 'Messagerie inaccessible' }),
  article('KB-2', { title: 'VPN déconnecté', symptom: 'Connexion perdue', category: 'Réseau', serviceId: 'SVC-VPN' }),
  article('KB-3', { title: 'Connexion lente au portail', category: 'Applications' }),
];
const draft = (title: string, more: Partial<{ category: string; serviceId: string }> = {}) => ({ title, category: 'Applications', serviceId: '', ...more });

test('KEDB suggestions match title words, ignoring case, accents and plurals', () => {
  assert.deepEqual(findKedbSuggestionsForDraft(kedb, draft('Les certificats ont EXPIRE')).map(a => a.id), ['KB-1']);
  assert.deepEqual(findKedbSuggestionsForDraft(kedb, draft('messagerie')).map(a => a.id), ['KB-1']);
});

test('KEDB suggestions rank the same service and category first', () => {
  assert.deepEqual(findKedbSuggestionsForDraft(kedb, draft('Connexion coupée')).map(a => a.id), ['KB-3', 'KB-2']);
  assert.deepEqual(findKedbSuggestionsForDraft(kedb, draft('Connexion coupée', { category: 'Réseau', serviceId: 'SVC-VPN' })).map(a => a.id), ['KB-2', 'KB-3']);
});

test('no KEDB suggestion without a meaningful shared word', () => {
  assert.deepEqual(findKedbSuggestionsForDraft(kedb, draft('')), []);
  assert.deepEqual(findKedbSuggestionsForDraft(kedb, draft('Impossible pour moi')), [], 'stop words only');
  assert.deepEqual(findKedbSuggestionsForDraft(kedb, draft('Imprimante bloquée')), []);
  assert.equal(findKedbSuggestionsForDraft(kedb, draft('connexion'), 1).length, 1);
});
