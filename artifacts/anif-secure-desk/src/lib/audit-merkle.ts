/**
 * Browser-side check of a journal inclusion proof (RFC 6962 / RFC 9162).
 * The server sends only seals; the verification runs here, so an auditor does
 * not have to trust the server's answer, only the checkpoint root they kept.
 */

const SEAL = /^[0-9a-f]{64}$/u;
const isSeal = (value: string) => SEAL.test(value);

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../gu) ?? [], (byte) => Number.parseInt(byte, 16));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

async function sha256(prefix: number, ...parts: Uint8Array[]): Promise<Uint8Array> {
  const data = new Uint8Array(1 + parts.reduce((total, part) => total + part.length, 0));
  data[0] = prefix;
  let offset = 1;
  for (const part of parts) { data.set(part, offset); offset += part.length; }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

export async function verifyMerkleInclusion(seal: string, index: number, size: number, proof: readonly string[], root: string): Promise<boolean> {
  if (!isSeal(seal) || !isSeal(root) || !Number.isSafeInteger(index) || !Number.isSafeInteger(size) || index < 0 || index >= size) return false;
  if (!proof.every(isSeal)) return false;
  let fn = index;
  let sn = size - 1;
  let r = await sha256(0, fromHex(seal));
  for (const hex of proof) {
    const p = fromHex(hex);
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = await sha256(1, p, r);
      while (fn % 2 === 0 && fn !== 0) { fn = Math.floor(fn / 2); sn = Math.floor(sn / 2); }
    } else {
      r = await sha256(1, r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && toHex(r) === root;
}

/** Text an auditor copies outside the pilot: tree size and root of a checkpoint. */
export const formatCheckpoint = (checkpoint: { size: number; root: string }) => `${checkpoint.size}:${checkpoint.root}`;

/** Read a checkpoint written by formatCheckpoint (spaces and case ignored). */
export function parseCheckpoint(text: string): { size: number; root: string } | null {
  const match = /^(\d{1,9})\s*:\s*([0-9a-fA-F]{64})$/u.exec(text.trim());
  if (!match) return null;
  const size = Number(match[1]);
  return size >= 1 ? { size, root: match[2]!.toLowerCase() } : null;
}
