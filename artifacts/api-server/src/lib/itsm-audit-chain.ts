import { createHash } from "node:crypto";

/**
 * Tamper-evident chaining of the ITSM activity journal.
 *
 * Every event receives a sequence number, the hash of the previous event and
 * its own SHA-256 hash over its canonical JSON. Changing, removing or
 * reordering a sealed event breaks the chain. This detects alterations made
 * outside the API (for example directly in the database), but anyone able to
 * rewrite the whole table can also recompute the chain: an auditor must keep
 * the latest seal (sequence + hash) elsewhere to prove later that nothing
 * before it was rewritten. It is not WORM storage nor a qualified timestamp.
 */

type JsonRecord = Record<string, unknown>;

export const AUDIT_CHAIN_GENESIS = "0".repeat(64);
/** Fields owned by the server; never accepted from a client or an import. */
export const AUDIT_CHAIN_FIELDS = ["seq", "prevHash", "hash", "pruned"] as const;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
};

export function stripAuditChainFields<T extends JsonRecord>(event: T): T {
  const copy = { ...event };
  for (const field of AUDIT_CHAIN_FIELDS) delete copy[field];
  return copy;
}

export function auditEventHash(event: JsonRecord): string {
  const { hash: _hash, ...content } = event;
  return createHash("sha256").update(JSON.stringify(canonical(content))).digest("hex");
}

const isSealed = (event: JsonRecord) =>
  Number.isSafeInteger(event.seq) && (event.seq as number) > 0 && typeof event.hash === "string";

export const isPrunedAuditEvent = (event: unknown) => isRecord(event) && event.pruned === true;

/**
 * Seal the events that have no seal yet. The journal is stored newest first;
 * unsealed events are sealed from the end of the array to the start, after the
 * highest existing sequence, so the first migration seals history oldest first.
 */
export function sealAuditEvents(events: readonly JsonRecord[]): JsonRecord[] {
  let head = { seq: 0, hash: AUDIT_CHAIN_GENESIS };
  for (const event of events) {
    if (isSealed(event) && (event.seq as number) > head.seq) {
      head = { seq: event.seq as number, hash: event.hash as string };
    }
  }
  const sealed = [...events];
  for (let index = sealed.length - 1; index >= 0; index -= 1) {
    const event = sealed[index]!;
    if (isSealed(event)) continue;
    const linked = { ...stripAuditChainFields(event), seq: head.seq + 1, prevHash: head.hash };
    const withHash = { ...linked, hash: auditEventHash(linked) };
    sealed[index] = withHash;
    head = { seq: withHash.seq, hash: withHash.hash };
  }
  return sealed;
}

/** Replace a sealed event by the minimum that keeps the chain verifiable. */
export function pruneAuditEvent(event: JsonRecord): JsonRecord {
  return { id: event.id, seq: event.seq, prevHash: event.prevHash, hash: event.hash, pruned: true };
}

export type AuditChainReport = {
  status: "intact" | "broken" | "empty" | "unsealed";
  events: number;
  verified: number;
  pruned: number;
  head: { seq: number; hash: string } | null;
  firstBreak: { seq: number | null; eventId: string | null; reason: string } | null;
};

export function verifyAuditChain(events: unknown): AuditChainReport {
  const list = Array.isArray(events) ? events.filter(isRecord) : [];
  const report = (
    status: AuditChainReport["status"],
    verified: number,
    pruned: number,
    head: AuditChainReport["head"],
    firstBreak: AuditChainReport["firstBreak"] = null,
  ): AuditChainReport => ({ status, events: list.length, verified, pruned, head, firstBreak });

  if (list.length === 0) return report("empty", 0, 0, null);
  const breakAt = (event: JsonRecord | null, reason: string, verified: number, pruned: number) =>
    report("broken", verified, pruned, null, {
      seq: event && Number.isSafeInteger(event.seq) ? event.seq as number : null,
      eventId: event && typeof event.id === "string" ? event.id : null,
      reason,
    });

  // A journal written before the chain existed has no seal at all: it is sealed at
  // the next server start or save. A missing seal among sealed events is a break.
  if (!list.some(isSealed)) return report("unsealed", 0, 0, null);
  const unsealed = list.find((event) => !isSealed(event));
  if (unsealed) return breakAt(unsealed, "Événement sans sceau", 0, 0);
  const ordered = [...list].sort((left, right) => (left.seq as number) - (right.seq as number));
  let previous = { seq: 0, hash: AUDIT_CHAIN_GENESIS };
  let verified = 0;
  let pruned = 0;
  let lastPrunedSeq = 0;
  let firstFullNonRoleSeq = Number.POSITIVE_INFINITY;
  for (const event of ordered) {
    const seq = event.seq as number;
    if (seq !== previous.seq + 1) {
      return breakAt(event, seq === previous.seq ? "Numéro de séquence en double" : `Séquence manquante avant ${seq}`, verified, pruned);
    }
    if (event.prevHash !== previous.hash) return breakAt(event, "Lien vers l’événement précédent incorrect", verified, pruned);
    if (event.pruned === true) {
      pruned += 1;
      lastPrunedSeq = seq;
    } else {
      if (auditEventHash(event) !== event.hash) return breakAt(event, "Contenu modifié après scellement", verified, pruned);
      if (typeof event.type !== "string" || !event.type.startsWith("itsm.role.")) {
        firstFullNonRoleSeq = Math.min(firstFullNonRoleSeq, seq);
      }
      verified += 1;
    }
    previous = { seq, hash: event.hash as string };
  }
  // Only the oldest ordinary events are ever purged; a purge after a kept one hides content.
  if (lastPrunedSeq > firstFullNonRoleSeq) {
    const suspicious = ordered.find((event) => event.pruned === true && (event.seq as number) > firstFullNonRoleSeq) ?? null;
    return breakAt(suspicious, "Événement purgé hors de l’ordre d’archivage", verified, pruned);
  }
  return report("intact", verified, pruned, previous);
}
