import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSISTANT_TOPICS, assistantReport, suggestArticles } from '../src/lib/support-assistant.ts';

const article = (id: string, category: string, title: string) => ({ id, title, symptom: '', rootCause: '', resolution: 'Procédure', ticketId: 'INC-1', category, createdAt: '', author: '' });
const printer = ASSISTANT_TOPICS.find((t) => t.id === 'printer')!;

test('every topic maps to a known ticket category and gives steps', () => {
  for (const topic of ASSISTANT_TOPICS) {
    assert.ok(['Applications', 'Poste de travail', 'Équipement', 'Réseau', 'Accès'].includes(topic.category));
    assert.ok(topic.steps.length >= 2);
  }
});

test('KEDB suggestions favour the same category, then keywords, accents ignored', () => {
  const found = suggestArticles(printer, [
    article('KB-1', 'Réseau', 'Lenteur VPN'),
    article('KB-2', 'Applications', 'Impression bloquée depuis la messagerie'),
    article('KB-3', 'Équipement', 'Imprimante du 2e étage hors ligne'),
  ]);
  assert.deepEqual(found.map((a) => a.id), ['KB-3', 'KB-2']);
});

test('the report summarises topic and checks without personal data', () => {
  const text = assistantReport(printer, [{ label: 'Liaison avec le serveur', ok: true, detail: '42 ms' }, { label: 'Réseau du poste', ok: false, detail: 'hors ligne' }]);
  assert.match(text, /^\[Assistant SI\] Imprimante ou périphérique \(catégorie Équipement\)\./);
  assert.match(text, /Liaison avec le serveur OK \(42 ms\) ; Réseau du poste ÉCHEC \(hors ligne\)/);
});
