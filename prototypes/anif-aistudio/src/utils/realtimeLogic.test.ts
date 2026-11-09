import { test } from 'node:test';
import assert from 'node:assert';
import {
  createWsEnvelope,
  parseWsMessage,
  applyIncomingMessage,
  buildNotificationFromMessage,
  validateIncomingMessage,
  appendWithCap
} from './realtimeLogic';
import { EncryptedMessage } from '../types';

test('createWsEnvelope creates well-formed JSON envelopes', () => {
  const envelopeJson = createWsEnvelope('AGENT_JOIN', { matricule: 'AGT-AN-042', nom: 'Marcelle Nguema' });
  const parsed = JSON.parse(envelopeJson);
  assert.strictEqual(parsed.type, 'AGENT_JOIN');
  assert.strictEqual(parsed.payload.matricule, 'AGT-AN-042');
  assert.strictEqual(typeof parsed.timestamp, 'number');
});

test('parseWsMessage parses valid JSON and rejects malformed strings', () => {
  const valid = '{"type":"PING","payload":{"time":12345}}';
  const parsed = parseWsMessage(valid);
  assert.ok(parsed);
  assert.strictEqual(parsed?.type, 'PING');

  assert.strictEqual(parseWsMessage('invalid-json{{{'), null);
  assert.strictEqual(parseWsMessage(''), null);
  assert.strictEqual(parseWsMessage('{"foo":"bar"}'), null); // missing type
});

test('applyIncomingMessage appends new messages into the proper channel', () => {
  const initialMap: Record<string, EncryptedMessage[]> = {
    'dos-bgf': []
  };

  const newMsg: EncryptedMessage = {
    id: 'MSG-TEST-1',
    canalId: 'dos-bgf',
    auteur: 'Col. Léon Mba',
    matricule: 'AGT-DG-001',
    roleNiveau: 1,
    texteClair: 'Test message',
    chiffreHex: 'aabbcc',
    ivHex: '1122',
    tagHex: '3344',
    timestamp: '12:00',
    timestampRFC3161: '2026-11-08 12:00:00 UTC',
    classification: 'TRÈS SECRET'
  };

  const res1 = applyIncomingMessage(initialMap, newMsg);
  assert.strictEqual(res1.isDuplicate, false);
  assert.strictEqual(res1.updated['dos-bgf'].length, 1);
  assert.strictEqual(res1.updated['dos-bgf'][0].id, 'MSG-TEST-1');
});

test('applyIncomingMessage idempotently ignores duplicate messages', () => {
  const existingMsg: EncryptedMessage = {
    id: 'MSG-EXISTING',
    canalId: 'dos-bgf',
    auteur: 'Marcelle Nguema',
    matricule: 'AGT-AN-042',
    roleNiveau: 2,
    texteClair: 'Already received',
    chiffreHex: 'ccdd',
    ivHex: '4455',
    tagHex: '6677',
    timestamp: '12:05',
    timestampRFC3161: '2026-11-08 12:05:00 UTC',
    classification: 'CONFIDENTIEL'
  };

  const mapWithMsg = { 'dos-bgf': [existingMsg] };
  const resDuplicate = applyIncomingMessage(mapWithMsg, existingMsg);

  assert.strictEqual(resDuplicate.isDuplicate, true);
  assert.strictEqual(resDuplicate.updated['dos-bgf'].length, 1);
});

test('buildNotificationFromMessage constructs an actionable notification', () => {
  const msg: EncryptedMessage = {
    id: 'MSG-NOTIF',
    canalId: 'dos-bgf',
    auteur: 'Marcelle Nguema',
    matricule: 'AGT-AN-042',
    roleNiveau: 2,
    texteClair: 'Virement suspect détecté',
    chiffreHex: '001122',
    ivHex: '3344',
    tagHex: '5566',
    timestamp: '14:30',
    timestampRFC3161: '2026-11-08 14:30:00 UTC',
    classification: 'CONFIDENTIEL'
  };

  const notif = buildNotificationFromMessage(msg, 'DOS-2026-BGF-089');
  assert.strictEqual(notif.type, 'MESSAGE');
  assert.strictEqual(notif.canalId, 'dos-bgf');
  assert.strictEqual(notif.senderMatricule, 'AGT-AN-042');
  assert.ok(notif.title.includes('DOS-2026-BGF-089'));
  assert.ok(notif.body.includes('Marcelle Nguema'));
});

test('validateIncomingMessage validates structural integrity of encrypted message', () => {
  const validMsg = {
    id: 'MSG-VALID',
    canalId: 'general',
    auteur: 'Admin',
    matricule: 'AGT-SSI-103',
    texteClair: 'Reboot prévu',
    chiffreHex: 'deadbeef'
  };
  assert.strictEqual(validateIncomingMessage(validMsg), true);

  assert.strictEqual(validateIncomingMessage(null), false);
  assert.strictEqual(validateIncomingMessage({ id: 'only-id' }), false);
  assert.strictEqual(validateIncomingMessage('string'), false);
});

test('validateIncomingMessage rejects prototype keys, oversized text and unknown channels', () => {
  const base = {
    id: 'MSG-1',
    canalId: 'CH-1',
    auteur: 'Agent',
    matricule: 'AGT-1',
    texteClair: 'bonjour',
    chiffreHex: 'abcd'
  };
  assert.equal(validateIncomingMessage(base), true);
  assert.equal(validateIncomingMessage({ ...base, canalId: '__proto__' }), false);
  assert.equal(validateIncomingMessage({ ...base, texteClair: 'x'.repeat(8001) }), false);
  assert.equal(validateIncomingMessage(base, new Set(['CH-2'])), false);
  assert.equal(validateIncomingMessage(base, new Set(['CH-1'])), true);
  assert.equal(validateIncomingMessage([base]), false);
});

test('appendWithCap keeps only the most recent messages of a channel', () => {
  let store: Record<string, EncryptedMessage[]> = {};
  for (let i = 0; i < 5; i++) {
    const msg = { id: `M-${i}`, canalId: 'CH-1', auteur: 'A', matricule: 'M', texteClair: `${i}`, chiffreHex: '' } as EncryptedMessage;
    store = appendWithCap(store, msg, 3).updated;
  }
  assert.deepEqual(store['CH-1'].map((m) => m.id), ['M-2', 'M-3', 'M-4']);
});
