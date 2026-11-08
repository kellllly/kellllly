import test from 'node:test';
import assert from 'node:assert/strict';
import { channelAccreditation, directPeer } from '../src/lib/protected-channel.ts';

test('restricted channels carry an accreditation badge; ordinary ones do not', () => {
  assert.match(channelAccreditation('Enquête') ?? '', /N1 · N2 invités/);
  assert.match(channelAccreditation('Direct') ?? '', /2 agents/);
  assert.match(channelAccreditation('Temporaire') ?? '', /durée limitée/);
  assert.equal(channelAccreditation('Équipe'), null);
  assert.equal(channelAccreditation('Support'), null);
});

test('a bilateral channel is named after the other agent, whoever looks at it', () => {
  const c = { kind: 'Direct', memberIds: ['user_a', 'user_b'], participants: ['user_a', 'user_b'] };
  assert.equal(directPeer(c, 'user_a'), 'user_b');
  assert.equal(directPeer(c, 'user_b'), 'user_a');
  assert.equal(directPeer({ ...c, kind: 'Équipe' }, 'user_a'), null);
});
