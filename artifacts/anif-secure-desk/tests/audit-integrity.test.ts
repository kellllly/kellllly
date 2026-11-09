import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAuditIntegrity } from '../src/lib/audit-integrity.ts';

const base = { events: 3, verified: 3, pruned: 0, head: null, firstBreak: null, merkle: null, checkedAt: '2026-11-07T12:00:00.000Z' };

test('an intact chain shows the count and the seal to keep', () => {
  const view = describeAuditIntegrity({ ...base, status: 'intact', head: { seq: 3, hash: 'ab'.repeat(32) } });
  assert.equal(view.tone, 'green');
  assert.equal(view.detail, '3 événements vérifiés.');
  assert.equal(view.seal, `n° 3 · ${'ab'.repeat(32)}`);
});

test('archived events are mentioned without hiding the verified count', () => {
  const view = describeAuditIntegrity({ ...base, status: 'intact', verified: 1, pruned: 2, head: { seq: 3, hash: 'cd'.repeat(32) } });
  assert.equal(view.detail, '1 événement vérifié. 2 anciens événements archivés ne gardent que leur empreinte.');
});

test('a broken chain names the event and gives no seal', () => {
  const view = describeAuditIntegrity({ ...base, status: 'broken', verified: 1, firstBreak: { seq: 2, eventId: 'b', reason: 'Contenu modifié après scellement' } });
  assert.equal(view.tone, 'red');
  assert.equal(view.seal, null);
  assert.match(view.detail, /^Contenu modifié après scellement à l’événement n° 2\./);
});

test('an empty journal is neutral', () => {
  assert.equal(describeAuditIntegrity({ ...base, events: 0, verified: 0, status: 'empty' }).tone, 'neutral');
});

test('a journal written before sealing existed is not reported as broken', () => {
  const view = describeAuditIntegrity({ ...base, verified: 0, status: 'unsealed' });
  assert.equal(view.tone, 'neutral');
  assert.equal(view.title, 'Journal pas encore scellé');
  assert.equal(view.seal, null);
});
