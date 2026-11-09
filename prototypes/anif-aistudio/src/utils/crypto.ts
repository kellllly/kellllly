/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * ANIF Gabon - Module Cryptographique Souverain (Web Crypto API Native)
 * Conforme standard Signal / Double Ratchet / AES-GCM 256 bits
 */

export async function generateSessionKey(): Promise<CryptoKey> {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    return await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }
  throw new Error('Web Crypto API non disponible dans cet environnement');
}

export async function encryptAESGCM(
  key: CryptoKey,
  plainText: string
): Promise<{ ivHex: string; cipherHex: string; tagHex: string }> {
  const encoder = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV standard NIST SP 800-38D
  const encodedText = encoder.encode(plainText);

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv, tagLength: 128 },
    key,
    encodedText
  );

  const encryptedArray = new Uint8Array(encryptedBuffer);
  // AES-GCM buffer contains ciphertext + 16-byte authentication tag
  const cipherBytes = encryptedArray.slice(0, encryptedArray.length - 16);
  const tagBytes = encryptedArray.slice(encryptedArray.length - 16);

  const toHex = (buf: Uint8Array) =>
    Array.from(buf)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  return {
    ivHex: toHex(iv),
    cipherHex: toHex(cipherBytes),
    tagHex: toHex(tagBytes)
  };
}

export async function decryptAESGCM(
  key: CryptoKey,
  cipherHex: string,
  ivHex: string,
  tagHex: string
): Promise<string> {
  const fromHex = (hex: string) => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
  };

  const iv = fromHex(ivHex);
  const cipherBytes = fromHex(cipherHex);
  const tagBytes = fromHex(tagHex);

  const fullBuffer = new Uint8Array(cipherBytes.length + tagBytes.length);
  fullBuffer.set(cipherBytes, 0);
  fullBuffer.set(tagBytes, cipherBytes.length);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv, tagLength: 128 },
    key,
    fullBuffer
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}

/**
 * Calcul SHA-256 déterministe pour vérification d'intégrité et feuilles de Merkle
 */
export async function sha256Hex(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(data);
  const hashBuffer = await (typeof window !== 'undefined' && window.crypto && window.crypto.subtle
    ? window.crypto.subtle.digest('SHA-256', buffer)
    : cryptoDigestFallback(buffer));

  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Fallback pour exécution hors navigateur ou tests unitaires
async function cryptoDigestFallback(buffer: Uint8Array): Promise<ArrayBuffer> {
  try {
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(buffer).digest();
    // Copie exacte des 32 octets : `hash.buffer` peut désigner un tampon partagé plus grand.
    return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength) as ArrayBuffer;
  } catch {
    // Ne jamais renvoyer une empreinte factice : toute la chaîne d'audit serait faussée.
    throw new Error('SHA-256 indisponible : ni Web Crypto ni node:crypto');
  }
}

export async function computeMerkleLeaf(
  prevHash: string,
  action: string,
  actor: string,
  details: string,
  timestamp: string
): Promise<string> {
  const payload = `${prevHash}|${action}|${actor}|${details}|${timestamp}`;
  return await sha256Hex(payload);
}

export function formatRFC3161Timestamp(date: Date = new Date()): string {
  return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC [RFC 3161]';
}
