/**
 * Property-based fuzzing of the browser-facing entry points: a browser can send
 * any JSON, so the server must never crash and never let a submitted value
 * override what it owns (journal seals, role events, other people's channels,
 * message authorship). Seeds are fixed so a failure is reproducible.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { sealAuditEvents, verifyAuditChain } from "../src/lib/itsm-audit-chain.ts";
import { checkAttachment, sanitizeAttachment } from "../src/lib/itsm-attachments.ts";
import { merkleInclusionProof, merkleRoot, verifyMerkleInclusion } from "../src/lib/itsm-audit-merkle.ts";
import { siemPage, toSiemRecord } from "../src/lib/itsm-audit-siem.ts";
import { ItsmAuthorizationError } from "../src/lib/itsm-rbac.ts";
import { applyWorkspaceUpdate, canSeeConversation, userStoreView, type WorkspaceActor } from "../src/lib/itsm-workspace.ts";

type JsonRecord = Record<string, unknown>;
const now = new Date("2026-11-09T12:00:00.000Z");
const RUNS = Number(process.env.FUZZ_RUNS ?? 150);
const SEED = Number(process.env.FUZZ_SEED ?? 20261109);

const actors: WorkspaceActor[] = [
  { id: "user_n1", role: "N1", serviceIds: [] },
  { id: "user_n2", role: "N2", serviceIds: [] },
  { id: "user_n3", role: "N3", serviceIds: ["SVC-01"] },
  { id: "user_n4", role: "N4", serviceIds: ["SVC-02"] },
  { id: "user_n5", role: "N5", serviceIds: [] },
];

const message = (id: string, author: string, body = "Bonjour") => ({ id, author, body, time: "10:00", at: "2026-11-09T10:00:00.000Z" });
const conversation = (id: string, kind: string, extra: JsonRecord = {}) => ({
  id, title: `Salon ${id}`, kind, classification: "Interne", participants: [], readCount: 0,
  messages: [message(`${id}-m1`, "user_n1")], ...extra,
});

const ticket = (id: string, serviceId: string, requester: string, status: string) => ({
  id, title: `Incident ${id}`, kind: "Incident", category: "Applications", impact: 2, urgency: 2, priority: "P2",
  supportLevel: 1, status, assignee: "Équipe support", requester, serviceId, assetId: null,
  openedAt: "2026-11-09T09:00:00.000Z", description: "Description fictive.", updates: [],
});

function baseStore(): JsonRecord {
  return {
    tickets: [
      ticket("INC-1", "SVC-01", "user_n2", "Nouveau"),
      ticket("INC-2", "SVC-02", "user_n4", "En cours"),
    ],
    services: [{ id: "SVC-01", name: "Messagerie" }, { id: "SVC-02", name: "Réseau" }],
    assets: [], kedb: [], notifications: [],
    conversations: [
      conversation("C-team", "Équipe"),
      conversation("C-support", "Support"),
      conversation("C-inv", "Enquête", { classification: "Restreint", memberIds: ["user_n1", "user_n2"] }),
      conversation("C-direct", "Direct", { classification: "Confidentiel", memberIds: ["user_n2", "user_n3"] }),
      conversation("C-temp", "Temporaire", { classification: "Restreint", memberIds: ["user_n1", "user_n5"], expiresAt: "2026-11-10T12:00:00.000Z" }),
      conversation("C-annonce", "Annonce"),
      conversation("C-admin", "Administratif"),
    ],
    audit: sealAuditEvents([
      { id: "a2", type: "itsm.role.changed", action: "Habilitation modifiée", actor: "user_n1", targetUserId: "user_n3", previousRole: "N2", nextRole: "N3", serviceIds: ["SVC-01"], scope: "N3", time: "09:00", at: "2026-11-09T09:00:00.000Z" },
      { id: "a1", action: "Session ouverte", actor: "user_n1", scope: "Pilote", time: "08:00", at: "2026-11-09T08:00:00.000Z" },
    ]),
  };
}

const KEYS = ["id", "kind", "memberIds", "participants", "messages", "author", "body", "system", "ticketId", "attachment",
  "ttlSeconds", "at", "time", "seq", "hash", "prevHash", "pruned", "type", "targetUserId", "nextRole", "status", "serviceId",
  "assignee", "requester", "classification", "expiresAt", "durationHours", "isInstruction", "expired", "readCount", "updates", "__proto__", "constructor"];
const key = fc.oneof(fc.constantFrom(...KEYS), fc.string({ maxLength: 12 }));
const value = fc.oneof(
  { weight: 3, arbitrary: fc.jsonValue({ maxDepth: 3 }) },
  fc.constantFrom("user_n1", "user_n2", "user_other", "N1", "N5", "Enquête", "Direct", "itsm.role.changed", "f".repeat(64), "INC-1", "SVC-01", -1, 1e308, ""),
);
const record = fc.dictionary(key, value, { maxKeys: 8 });
const COLLECTIONS = ["tickets", "conversations", "audit", "services", "assets", "kedb", "notifications"] as const;

type Op =
  | { op: "replace"; collection: string; value: unknown }
  | { op: "push"; collection: (typeof COLLECTIONS)[number]; value: JsonRecord }
  | { op: "edit"; collection: (typeof COLLECTIONS)[number]; index: number; key: string; value: unknown }
  | { op: "message"; index: number; value: JsonRecord };
const plausibleMessage = fc.record({
  id: fc.string({ maxLength: 10 }), body: fc.oneof(fc.string({ minLength: 1, maxLength: 60 }), value),
  author: fc.constantFrom("user_n1", "user_other", ""), system: fc.oneof(fc.boolean(), value),
  ticketId: fc.oneof(fc.constant("INC-1"), value), ttlSeconds: fc.oneof(fc.integer({ min: -10, max: 4_000_000 }), value),
  isInstruction: fc.oneof(fc.boolean(), value), attachment: fc.oneof(fc.constant(undefined), record), at: value,
}, { requiredKeys: ["id", "body"] });
const op: fc.Arbitrary<Op> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ op: fc.constant("message" as const), index: fc.nat(8), value: plausibleMessage }) },
  { weight: 3, arbitrary: fc.record({ op: fc.constant("edit" as const), collection: fc.constantFrom("conversations" as const, "tickets" as const), index: fc.nat(8), key, value }) },
  fc.record({ op: fc.constant("replace" as const), collection: fc.oneof(fc.constantFrom(...COLLECTIONS, "profile"), fc.string({ maxLength: 8 })), value }),
  fc.record({ op: fc.constant("push" as const), collection: fc.constantFrom(...COLLECTIONS), value: record }),
  fc.record({ op: fc.constant("edit" as const), collection: fc.constantFrom(...COLLECTIONS), index: fc.nat(8), key, value }),
  fc.record({ op: fc.constant("message" as const), index: fc.nat(8), value: record }),
);

function mutate(view: JsonRecord, ops: Op[]): JsonRecord {
  const submitted = structuredClone(view);
  for (const step of ops) {
    const list = submitted[step.collection as string];
    if (step.op === "replace") submitted[step.collection] = step.value;
    else if (step.op === "push") { if (Array.isArray(list)) list.unshift(step.value); }
    else if (step.op === "edit") {
      if (Array.isArray(list) && list.length && list[step.index % list.length] && typeof list[step.index % list.length] === "object") {
        (list[step.index % list.length] as JsonRecord)[step.key] = step.value;
      }
    } else {
      const conversations = submitted.conversations;
      if (Array.isArray(conversations) && conversations.length) {
        const target = conversations[step.index % conversations.length] as JsonRecord | undefined;
        if (target && Array.isArray(target.messages)) target.messages.push(step.value);
      }
    }
  }
  return submitted;
}

const records = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []);
const roleEvents = (store: JsonRecord) => records(store.audit).filter((event) => typeof event.type === "string" && event.type.startsWith("itsm.role."));

test("the fuzzing baseline is valid: sending back one's own view is accepted for N1 to N4", () => {
  for (const actor of actors.filter((item) => item.role !== "N5")) {
    const current = baseStore();
    assert.doesNotThrow(() => applyWorkspaceUpdate(current, structuredClone(userStoreView(current, actor)), actor, now), actor.role);
  }
});

test("fuzz: any submitted workspace is refused cleanly or keeps every server-owned guarantee", () => {
  let accepted = 0;
  fc.assert(fc.property(fc.constantFrom(...actors), fc.array(op, { minLength: 1, maxLength: 4 }), (actor, ops) => {
    const current = baseStore();
    const submitted = mutate(structuredClone(userStoreView(current, actor)), ops);
    let next: JsonRecord;
    try {
      next = applyWorkspaceUpdate(current, submitted, actor, now);
      accepted += 1;
    } catch (error) {
      // A refusal is fine; a programming error (TypeError, RangeError…) is a bug.
      assert.ok(error instanceof ItsmAuthorizationError || (error as Error)?.constructor === Error, `unexpected ${(error as Error)?.constructor?.name}: ${(error as Error)?.message}`);
      return;
    }
    // The journal stays a valid chain and no submitted value forges a role event.
    assert.equal(verifyAuditChain(next.audit).status, "intact");
    assert.deepEqual(roleEvents(next), roleEvents(current), "a browser cannot add or alter a role event");
    // Channels the actor cannot see come back untouched.
    for (const hidden of records(current.conversations).filter((item) => !canSeeConversation(actor, item, now))) {
      const after = records(next.conversations).find((item) => item.id === hidden.id);
      assert.deepEqual(after, hidden, `hidden channel ${String(hidden.id)} was changed by ${actor.role}`);
    }
    // Every new message is written by the actor, never as a system notice.
    const known = new Set(records(current.conversations).flatMap((item) => records(item.messages).map((entry) => entry.id)));
    for (const item of records(next.conversations)) {
      for (const entry of records(item.messages).filter((candidate) => !known.has(candidate.id))) {
        if (entry.system === true) continue; // server notices (ticket conversion) are written by the server itself
        assert.equal(entry.author, actor.id, "a new message is always authored by the actor");
      }
    }
  }), { numRuns: RUNS, seed: SEED });
  // Without this, a baseline the server always refuses would make every property vacuous.
  assert.ok(accepted >= RUNS * 0.15, `only ${accepted}/${RUNS} fuzzed updates were accepted`);
});

test("fuzz: attachment descriptions never crash and keep only bounded, typed fields", () => {
  const attachment = fc.record({
    name: fc.oneof(fc.string({ maxLength: 200 }), fc.constantFrom("note.pdf", "photo.JPG", "macro.docm", "a/b.pdf", "x.exe")),
    type: fc.oneof(fc.string({ maxLength: 200 }), fc.constantFrom("application/pdf", "image/jpeg")),
    size: fc.oneof(fc.integer({ min: -5, max: 40_000_000 }), fc.double(), fc.string()),
    sha256: fc.oneof(fc.stringMatching(/^[0-9a-fA-F]{64}$/u), fc.string({ maxLength: 70 })),
    acknowledged: fc.oneof(fc.boolean(), fc.jsonValue()),
    warnings: fc.jsonValue(),
  }, { requiredKeys: [] });
  fc.assert(fc.property(fc.oneof(fc.jsonValue({ maxDepth: 3 }), record, attachment), (raw) => {
    let clean: JsonRecord | undefined;
    try {
      clean = sanitizeAttachment(raw);
    } catch (error) {
      // A refusal (plain Error, answered 400) is fine; any other error type is a crash.
      assert.equal((error as Error)?.constructor, Error, `unexpected ${(error as Error)?.constructor?.name}`);
      return;
    }
    if (clean === undefined) return;
    for (const [field, item] of Object.entries(clean)) {
      assert.ok(["name", "type", "size", "sha256", "warnings", "acknowledged"].includes(field), `unexpected field ${field}`);
      if (typeof item === "string") assert.ok(item.length <= 300, `${field} too long`);
    }
  }), { numRuns: RUNS * 4, seed: SEED });
});

test("fuzz: an executable stays refused whatever its case, padding or double extension", () => {
  const executable = fc.constantFrom("exe", "bat", "cmd", "ps1", "vbs", "js", "scr", "msi", "jar", "sh");
  fc.assert(fc.property(fc.string({ maxLength: 20 }), fc.constantFrom("", ".pdf", ".docx", ".jpg"), executable, fc.boolean(), (stem, decoy, extension, upper) => {
    const name = `${stem.replace(/[./\\]/gu, "")}${decoy}.${upper ? extension.toUpperCase() : extension}`;
    assert.ok(checkAttachment(name, "application/pdf", 1000).blocked, name);
  }), { numRuns: RUNS * 2, seed: SEED });
});

test("fuzz: Merkle proofs verify for every leaf and only for that leaf", () => {
  const seal = fc.stringMatching(/^[0-9a-f]{64}$/u);
  fc.assert(fc.property(fc.array(seal, { minLength: 1, maxLength: 70 }), fc.nat(), fc.nat(), (seals, a, b) => {
    const size = 1 + (b % seals.length);
    const index = a % size;
    const proof = merkleInclusionProof(seals, index, size);
    const root = merkleRoot(seals, size);
    assert.ok(verifyMerkleInclusion(seals[index]!, index, size, proof, root));
    if (size > 1) {
      const other = (index + 1) % size;
      if (seals[other] !== seals[index]) assert.equal(verifyMerkleInclusion(seals[other]!, index, size, proof, root), false);
    }
  }), { numRuns: RUNS * 2, seed: SEED });
});

test("fuzz: the SIEM feed never leaks an unmapped field and always moves forward", () => {
  const secret = "SECRET-NON-EXPORTE";
  fc.assert(fc.property(fc.array(record, { maxLength: 30 }), fc.nat(40), fc.integer({ min: 1, max: 20 }), (events, after, limit) => {
    const journal = sealAuditEvents(events.map((event, index) => ({ ...event, id: `e${index}`, leak: secret })));
    for (const event of journal) assert.doesNotMatch(JSON.stringify(toSiemRecord(event)), new RegExp(secret, "u"));
    const page = siemPage(journal, after, limit);
    assert.ok(page.lines.length <= limit);
    assert.ok(page.next >= after);
    const sequences = page.lines.map((line) => JSON.parse(line).event.sequence as number);
    assert.deepEqual(sequences, [...sequences].sort((x, y) => x - y));
    assert.ok(sequences.every((seq) => seq > after));
  }), { numRuns: RUNS * 2, seed: SEED });
});
