import { createHash, randomBytes, webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";

/**
 * RFC 3161 timestamps of the journal's Merkle checkpoints.
 *
 * A timestamp authority (TSA) signs the SHA-256 of the fixed text
 * `anif-merkle-checkpoint:v1:<size>:<root>`. The signed token proves that this
 * root existed at the TSA's date, independently of the pilot: if the first
 * <size> events are later rewritten, their Merkle root no longer matches.
 * The token is kept whole so anyone can check it with `openssl ts -verify`.
 * Whether the TSA is qualified (eIDAS) depends on the authority configured.
 */

pkijs.setEngine("node", new pkijs.CryptoEngine({ name: "node", crypto: webcrypto as unknown as Crypto }) as unknown as pkijs.ICryptoEngine);

export const ITSM_AUDIT_TIMESTAMP_TYPE = "itsm.audit.timestamped";
const SHA256_OID = "2.16.840.1.101.3.4.2.1";
const TST_INFO_OID = "1.2.840.113549.1.9.16.1.4";
const TIME_STAMPING_EKU = "1.3.6.1.5.5.7.3.8";

const view = (buffer: Buffer) => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
const hex = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("hex");

/** Text a checkpoint stands for; its SHA-256 is what the TSA signs. */
export const checkpointStatement = (size: number, root: string) => `anif-merkle-checkpoint:v1:${size}:${root}`;
export const checkpointDigest = (size: number, root: string) =>
  createHash("sha256").update(checkpointStatement(size, root)).digest();
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest();

/** DER TimeStampReq for a SHA-256 digest, asking the TSA to include its certificate. */
export function buildTimestampRequest(digest: Buffer, nonce: Buffer = randomBytes(8)): Buffer {
  const request = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({
      hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SHA256_OID, algorithmParams: new asn1js.Null() }),
      hashedMessage: new asn1js.OctetString({ valueHex: view(digest) }),
    }),
    // A leading 0x01 keeps the INTEGER positive whatever the random bytes are.
    nonce: new asn1js.Integer({ valueHex: view(Buffer.concat([Buffer.from([1]), nonce])) }),
    certReq: true,
  });
  return Buffer.from(request.toSchema().toBER(false));
}

export const requestNonce = (request: Buffer) => {
  const parsed = pkijs.TimeStampReq.fromBER(view(request));
  return parsed.nonce ? hex(parsed.nonce.valueBlock.valueHexView) : null;
};

export type TimestampVerification = {
  /** Signature by the certificate the TSA embedded, and imprint and nonce checks. */
  valid: boolean;
  /** true only when ITSM_TSA_TRUSTED_CERTS was given and the chain reached it. */
  chainVerified: boolean;
  genTime: string | null;
  serial: string | null;
  policy: string | null;
  tsaSubject: string | null;
  problem: string | null;
};

const fail = (problem: string, partial: Partial<TimestampVerification> = {}): TimestampVerification => ({
  valid: false, chainVerified: false, genTime: null, serial: null, policy: null, tsaSubject: null, problem, ...partial,
});

const subjectOf = (certificate: pkijs.Certificate | null | undefined) =>
  certificate?.subject.typesAndValues.map((item) => item.value.valueBlock.value).join(", ") ?? null;

/** Parse PEM certificates (ITSM_TSA_TRUSTED_CERTS). */
export function parseCertificates(pem: string | undefined): pkijs.Certificate[] {
  if (!pem) return [];
  return [...pem.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/gu)]
    .map((match) => pkijs.Certificate.fromBER(view(Buffer.from(match[1]!.replace(/\s+/gu, ""), "base64"))));
}

/**
 * Check a TimeStampResp (or a bare TimeStampToken) against the statement that
 * was timestamped (its SHA-256 is the imprint). Never throws: a malformed token
 * is reported as invalid.
 */
export async function verifyTimestamp(
  der: Buffer,
  statement: Buffer,
  { nonce = null, trustedCerts = [] }: { nonce?: string | null; trustedCerts?: pkijs.Certificate[] } = {},
): Promise<TimestampVerification> {
  const digest = sha256(statement);
  try {
    let token: pkijs.ContentInfo;
    try {
      const response = pkijs.TimeStampResp.fromBER(view(der));
      if (response.status.status !== 0 && response.status.status !== 1) {
        return fail(`L’autorité a refusé l’horodatage (statut ${response.status.status}).`);
      }
      if (!response.timeStampToken) return fail("La réponse ne contient pas de jeton.");
      token = response.timeStampToken;
    } catch {
      token = pkijs.ContentInfo.fromBER(view(der));
    }
    const signedData = new pkijs.SignedData({ schema: token.content });
    if (signedData.encapContentInfo.eContentType !== TST_INFO_OID || !signedData.encapContentInfo.eContent) {
      return fail("Le jeton ne contient pas d’information d’horodatage (TSTInfo).");
    }
    const tstInfo = pkijs.TSTInfo.fromBER(signedData.encapContentInfo.eContent.getValue());
    const details = {
      genTime: tstInfo.genTime.toISOString(),
      serial: hex(tstInfo.serialNumber.valueBlock.valueHexView),
      policy: tstInfo.policy,
    };
    if (tstInfo.messageImprint.hashAlgorithm.algorithmId !== SHA256_OID) return fail("Algorithme d’empreinte inattendu.", details);
    if (hex(tstInfo.messageImprint.hashedMessage.valueBlock.valueHexView) !== digest.toString("hex")) {
      return fail("L’empreinte horodatée ne correspond pas à ce point de contrôle.", details);
    }
    if (nonce && (!tstInfo.nonce || hex(tstInfo.nonce.valueBlock.valueHexView) !== nonce)) {
      return fail("Le nonce de la réponse ne correspond pas à la demande.", details);
    }
    type Outcome = { signatureVerified?: boolean | null; signerCertificate?: pkijs.Certificate | null; signerCertificateVerified?: boolean | null };
    // For a TSTInfo, pkijs hashes `data` and compares it with the imprint: pass the statement itself.
    const check = (chain: boolean) => signedData.verify({
      signer: 0, data: view(statement), trustedCerts, checkChain: chain, extendedMode: true,
    }).then((value) => value as Outcome, (error: Outcome) => error);
    // Signature first, without the chain: a chain failure must not read as a forged signature.
    const result = await check(false);
    const signer = result.signerCertificate ?? null;
    const tsaSubject = subjectOf(signer);
    if (!result.signatureVerified) return fail("La signature de l’autorité est invalide.", { ...details, tsaSubject });
    const eku = signer?.extensions?.find((extension) => extension.extnID === "2.5.29.37");
    const usages = (eku?.parsedValue as pkijs.ExtKeyUsage | undefined)?.keyPurposes ?? [];
    if (!usages.includes(TIME_STAMPING_EKU)) {
      return fail("Le certificat signataire n’est pas un certificat d’horodatage.", { ...details, tsaSubject });
    }
    const chainVerified = trustedCerts.length > 0 && (await check(true)).signerCertificateVerified === true;
    if (trustedCerts.length > 0 && !chainVerified) {
      return fail("Le certificat de l’autorité ne remonte pas à une racine de confiance configurée.", { ...details, tsaSubject });
    }
    return { valid: true, chainVerified, ...details, tsaSubject, problem: null };
  } catch {
    return fail("Jeton d’horodatage illisible.");
  }
}

/** Send a TimeStampReq to the TSA and return the raw DER response. */
export async function requestTimestamp(
  url: string,
  request: Buffer,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000,
): Promise<Buffer> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/timestamp-query", Accept: "application/timestamp-reply" },
    body: new Uint8Array(request),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Autorité d’horodatage indisponible (HTTP ${response.status}).`);
  const body = Buffer.from(await response.arrayBuffer());
  if (body.length === 0 || body.length > 64 * 1024) throw new Error("Réponse d’horodatage de taille inattendue.");
  return body;
}
