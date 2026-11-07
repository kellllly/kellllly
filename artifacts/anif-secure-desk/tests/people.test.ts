import test from 'node:test';
import assert from 'node:assert/strict';
import { batches, collectUserIds, labelPeople } from '../src/lib/people.ts';

const a = 'user_3LmUjSSM4ppKElAXb0yhnveCpYw';
const b = 'user_3LZmdocmigvCuncvHWpXpXk3qCY';

test('user IDs are collected from nested values and embedded text', () => {
  const store = {
    tickets: [{ requester: a, cab: { by: `CAB simulé · ${b}` }, updates: [{ author: 'Olivier Nguema' }] }],
    conversations: [{ participants: [a, 'Équipe'] }],
    audit: [{ actor: b }],
    version: 4,
  };
  assert.deepEqual(collectUserIds(store), [b, a].sort());
});

test('names replace IDs in text, other text and unknown IDs are unchanged', () => {
  const names = new Map([[a, 'Awa Mba']]);
  assert.equal(labelPeople(a, names), 'Awa Mba');
  assert.equal(labelPeople(`CAB simulé · ${a}`, names), 'CAB simulé · Awa Mba');
  assert.equal(labelPeople(b, names), b);
  assert.equal(labelPeople('Équipe infrastructure', names), 'Équipe infrastructure');
  assert.equal(labelPeople(undefined, names), '');
});

test('requests are split in batches the API accepts', () => {
  const ids = Array.from({ length: 205 }, (_, i) => `user_${String(i).padStart(6, '0')}`);
  assert.deepEqual(batches(ids).map((batch) => batch.length), [100, 100, 5]);
});

test('server accounts in the journal get a readable label', () => {
  assert.equal(labelPeople('system:sla-monitor', new Map()), 'Surveillance SLA (serveur)');
  assert.equal(labelPeople('system:itsm-bootstrap', new Map()), 'Initialisation (serveur)');
});
