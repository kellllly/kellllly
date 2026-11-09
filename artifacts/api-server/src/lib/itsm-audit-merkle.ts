import { createHash } from "node:crypto";

/**
 * Merkle tree over the sealed journal (RFC 6962 / RFC 9162 construction).
 *
 * Leaves are the event seals (`hash`, 32 bytes) in sequence order, pruned
 * stubs included: they keep their seal. An auditor who writes down the root and
 * the tree size of a checkpoint can later ask for an inclusion proof of any
 * event against that same size and check it without trusting the server:
 * a rewritten event, or one inserted before the checkpoint, no longer matches
 * the root they kept. It is not a qualified timestamp (RFC 3161) nor WORM.
 */

const sha256 = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();
const LEAF = Buffer.from([0]);
const NODE = Buffer.from([1]);

const SEAL = /^[0-9a-f]{64}$/u;
export const isSeal = (value: unknown): value is string => typeof value === "string" && SEAL.test(value);

export const merkleLeafHash = (seal: string) => sha256(LEAF, Buffer.from(seal, "hex"));

/** Largest power of two strictly smaller than n (n ≥ 2). */
const split = (n: number) => {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
};

function subtreeHash(leaves: readonly Buffer[], start: number, end: number): Buffer {
  const n = end - start;
  if (n === 1) return leaves[start]!;
  const k = split(n);
  return sha256(NODE, subtreeHash(leaves, start, start + k), subtreeHash(leaves, start + k, end));
}

/** Root of the first `size` seals (hex). The empty tree hashes the empty string. */
export function merkleRoot(seals: readonly string[], size = seals.length): string {
  if (size === 0) return sha256().toString("hex");
  const leaves = seals.slice(0, size).map(merkleLeafHash);
  return subtreeHash(leaves, 0, size).toString("hex");
}

/** Audit path of leaf `index` in the tree of the first `size` seals (hex, bottom-up). */
export function merkleInclusionProof(seals: readonly string[], index: number, size = seals.length): string[] {
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(size) || size > seals.length || index < 0 || index >= size) {
    throw new RangeError("Leaf index outside the tree");
  }
  const leaves = seals.slice(0, size).map(merkleLeafHash);
  const path: Buffer[] = [];
  const walk = (m: number, start: number, end: number) => {
    const n = end - start;
    if (n === 1) return;
    const k = split(n);
    if (m < k) {
      walk(m, start, start + k);
      path.push(subtreeHash(leaves, start + k, end));
    } else {
      walk(m - k, start + k, end);
      path.push(subtreeHash(leaves, start, start + k));
    }
  };
  walk(index, 0, size);
  return path.map((node) => node.toString("hex"));
}

/** RFC 9162 §2.1.3.2 verification of an inclusion proof. */
export function verifyMerkleInclusion(seal: string, index: number, size: number, proof: readonly string[], root: string): boolean {
  if (!isSeal(seal) || !isSeal(root) || !Number.isSafeInteger(index) || !Number.isSafeInteger(size) || index < 0 || index >= size) return false;
  if (!proof.every(isSeal)) return false;
  let fn = index;
  let sn = size - 1;
  let r = merkleLeafHash(seal);
  for (const hex of proof) {
    const p = Buffer.from(hex, "hex");
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = sha256(NODE, p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
      }
    } else {
      r = sha256(NODE, r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && r.toString("hex") === root;
}
