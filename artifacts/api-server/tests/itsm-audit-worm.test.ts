import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { sealAuditEvents } from "../src/lib/itsm-audit-chain.ts";
import { compareWithArchive, type ArchivedSeal } from "../src/lib/itsm-audit-worm.ts";
import { createItsmAuditIntegrityHandler } from "../src/routes/itsm-audit-export.ts";

const event = (id: string) => ({ id, action: `Action ${id}`, actor: "user_a", scope: "Pilote", time: "10:00" });
const journal = (n: number) => sealAuditEvents(Array.from({ length: n }, (_, i) => event(`e${n - i}`)));
const sealsOf = (events: Record<string, unknown>[]): ArchivedSeal[] =>
  events.map((item) => ({ seq: item.seq as number, hash: item.hash as string }));

test("a journal that holds every archived seal is consistent, newer seals are counted as not archived", () => {
  const events = journal(5);
  const archived = sealsOf(events).filter((seal) => seal.seq <= 3);
  assert.deepEqual(compareWithArchive(events, archived), { status: "consistent", archived: 3, unarchived: 2, firstMismatch: null });
  assert.deepEqual(compareWithArchive(events, null), { status: "not_installed", archived: 0, unarchived: 5, firstMismatch: null });
  assert.deepEqual(compareWithArchive([], []), { status: "consistent", archived: 0, unarchived: 0, firstMismatch: null });
});

test("a removed or re-sealed event diverges from the archive, at the first archived seal affected", () => {
  const events = journal(5);
  const archived = sealsOf(events);
  const withoutTwo = events.filter((item) => item.seq !== 2 && item.seq !== 4);
  assert.deepEqual(compareWithArchive(withoutTwo, archived).firstMismatch, { seq: 2, reason: "missing" });
  // Rewriting event 3 and recomputing the whole chain gives a coherent chain, but other seals.
  const rewritten = sealAuditEvents(events.map(({ seq, prevHash, hash, ...rest }) =>
    (rest.id === "e3" ? { ...rest, action: "réécrit" } : rest)));
  const report = compareWithArchive(rewritten, archived);
  assert.equal(report.status, "diverged");
  assert.deepEqual(report.firstMismatch, { seq: 3, reason: "changed" });
  assert.deepEqual(compareWithArchive(events, [...archived].reverse()).status, "consistent", "archive order does not matter");
  assert.equal(compareWithArchive([null, "x", [], { seq: 0 }, { seq: 1.5 }], [{ seq: 1, hash: "a".repeat(64) }]).firstMismatch?.reason, "missing");
});

test("the integrity route reports the archive and withholds the checkpoint of a journal that diverges from it", async (t) => {
  const kept = journal(4);
  let events: Record<string, unknown>[] = kept;
  let archived: ArchivedSeal[] | null = sealsOf(kept);
  let archiveFails = false;
  const app = express();
  app.get("/integrity", createItsmAuditIntegrityHandler({
    resolveActor: async () => ({ id: "user_x", role: "N1", serviceIds: [] }),
    loadAuditEvents: async () => events,
    loadArchivedSeals: async () => {
      if (archiveFails) throw new Error("base indisponible");
      return archived;
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/integrity`;
  const read = async () => (await fetch(url)).json();

  const intact = await read();
  assert.equal(intact.status, "intact");
  assert.deepEqual(intact.archive, { status: "consistent", archived: 4, unarchived: 0, firstMismatch: null });
  assert.equal(intact.merkle.size, 4);

  // Whole journal rewritten and re-sealed: the chain verifies, the archive does not.
  events = sealAuditEvents(kept.map(({ seq, prevHash, hash, ...rest }) => (rest.id === "e1" ? { ...rest, action: "réécrit" } : rest)));
  const forged = await read();
  assert.equal(forged.status, "intact");
  assert.equal(forged.archive.status, "diverged");
  assert.deepEqual(forged.archive.firstMismatch, { seq: 1, reason: "changed" });
  assert.equal(forged.merkle, null);

  events = kept;
  archived = null;
  const legacy = await read();
  assert.equal(legacy.archive.status, "not_installed");
  assert.equal(legacy.merkle.size, 4, "without the archive the checkpoint still comes from the chain");

  archiveFails = true;
  assert.equal((await fetch(url)).status, 503);
});

test("only plain events with a positive integer seq count as journal seals", () => {
  const hash = "b".repeat(64);
  const junk = [null, "x", Object.assign([], { seq: 2, hash }), { seq: 0, hash }, { seq: -3, hash }, { seq: 1.5, hash }, { seq: "4", hash }];
  assert.deepEqual(compareWithArchive([...junk, { seq: 1, hash }], []), { status: "consistent", archived: 0, unarchived: 1, firstMismatch: null });
  for (const seq of [2, 4]) {
    assert.deepEqual(compareWithArchive(junk, [{ seq, hash }]).firstMismatch, { seq, reason: "missing" }, `seq ${seq} must not be read from an array or a string`);
  }
});
