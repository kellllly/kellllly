import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { formatCheckpoint, parseCheckpoint, verifyMerkleInclusion } from '../src/lib/audit-merkle.ts';
// The server builds the proofs; the browser must accept exactly the server's valid proofs.
import { merkleInclusionProof, merkleRoot } from '../../api-server/src/lib/itsm-audit-merkle.ts';

const seals = (n: number) => Array.from({ length: n }, (_, i) => createHash('sha256').update(`e${i}`).digest('hex'));

test('the browser check accepts every server proof of trees of 1 to 20 events', async () => {
  for (let size = 1; size <= 20; size += 1) {
    const list = seals(size);
    const root = merkleRoot(list);
    for (let index = 0; index < size; index += 1) {
      assert.equal(await verifyMerkleInclusion(list[index]!, index, size, merkleInclusionProof(list, index), root), true, `size ${size}, index ${index}`);
    }
  }
});

test('the browser check rejects another event, a shortened proof and another root', async () => {
  const list = seals(9);
  const root = merkleRoot(list);
  const proof = merkleInclusionProof(list, 4);
  assert.equal(await verifyMerkleInclusion(list[5]!, 4, 9, proof, root), false);
  assert.equal(await verifyMerkleInclusion(list[4]!, 4, 9, proof.slice(1), root), false);
  assert.equal(await verifyMerkleInclusion(list[4]!, 4, 9, proof, merkleRoot(list, 8)), false);
  assert.equal(await verifyMerkleInclusion('pas-une-empreinte', 4, 9, proof, root), false);
});

test('a checkpoint copied outside the pilot is read back', () => {
  const root = 'A'.repeat(64);
  assert.deepEqual(parseCheckpoint(` ${formatCheckpoint({ size: 12, root })} `), { size: 12, root: 'a'.repeat(64) });
  assert.deepEqual(parseCheckpoint(`12 : ${'b'.repeat(64)}`), { size: 12, root: 'b'.repeat(64) });
  assert.equal(parseCheckpoint('12:abc'), null);
  assert.equal(parseCheckpoint(`0:${'a'.repeat(64)}`), null);
});
