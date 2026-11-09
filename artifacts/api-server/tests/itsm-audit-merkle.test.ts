import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import { sealAuditEvents } from "../src/lib/itsm-audit-chain.ts";
import { merkleInclusionProof, merkleRoot, verifyMerkleInclusion } from "../src/lib/itsm-audit-merkle.ts";
import { createItsmAuditIntegrityHandler, createItsmAuditProofHandler } from "../src/routes/itsm-audit-export.ts";

const seal = (i: number) => createHash("sha256").update(`event-${i}`).digest("hex");
const seals = (n: number) => Array.from({ length: n }, (_, i) => seal(i));
const h = (...parts: Buffer[]) => createHash("sha256").update(Buffer.concat(parts)).digest();
const leaf = (hex: string) => h(Buffer.from([0]), Buffer.from(hex, "hex"));

test("roots follow RFC 6962: empty tree, one leaf, and an unbalanced tree of three", () => {
  assert.equal(merkleRoot([]), createHash("sha256").update("").digest("hex"));
  const [a, b, c] = seals(3);
  assert.equal(merkleRoot([a!]), leaf(a!).toString("hex"));
  const ab = h(Buffer.from([1]), leaf(a!), leaf(b!));
  assert.equal(merkleRoot([a!, b!, c!]), h(Buffer.from([1]), ab, leaf(c!)).toString("hex"));
});

test("every event of trees of 1 to 33 events has a proof that verifies, and only that one", () => {
  for (let size = 1; size <= 33; size += 1) {
    const list = seals(size);
    const root = merkleRoot(list);
    for (let index = 0; index < size; index += 1) {
      const proof = merkleInclusionProof(list, index);
      assert.ok(verifyMerkleInclusion(list[index]!, index, size, proof, root), `size ${size}, index ${index}`);
      if (size > 1) {
        assert.equal(verifyMerkleInclusion(list[(index + 1) % size]!, index, size, proof, root), false, "another event must not match");
        assert.equal(verifyMerkleInclusion(list[index]!, (index + 1) % size, size, proof, root), false, "another position must not match");
      }
    }
  }
});

test("a proof for an earlier checkpoint verifies against the root kept at that time", () => {
  const before = seals(10);
  const keptRoot = merkleRoot(before);
  const after = [...before, ...seals(25).slice(10)];
  const proof = merkleInclusionProof(after, 3, 10);
  assert.ok(verifyMerkleInclusion(after[3]!, 3, 10, proof, keptRoot));
  // An event rewritten after the checkpoint no longer matches the root kept.
  const rewritten = [...after];
  rewritten[3] = seal(999);
  assert.equal(verifyMerkleInclusion(rewritten[3]!, 3, 10, merkleInclusionProof(rewritten, 3, 10), keptRoot), false);
});

test("a tampered proof or root is rejected", () => {
  const list = seals(7);
  const root = merkleRoot(list);
  const proof = merkleInclusionProof(list, 2);
  const flipped = [...proof];
  flipped[0] = flipped[0]!.replace(/^./u, (char) => (char === "0" ? "1" : "0"));
  assert.equal(verifyMerkleInclusion(list[2]!, 2, 7, flipped, root), false);
  assert.equal(verifyMerkleInclusion(list[2]!, 2, 7, proof.slice(1), root), false);
  assert.equal(verifyMerkleInclusion(list[2]!, 2, 7, [...proof, proof[0]!], root), false);
  assert.equal(verifyMerkleInclusion(list[2]!, 2, 7, proof, "0".repeat(64)), false);
  assert.throws(() => merkleInclusionProof(list, 7));
});

const event = (id: string) => ({ id, action: `Action ${id}`, actor: "user_a", scope: "Pilote", time: "10:00" });

async function serve(t: test.TestContext, app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("the integrity route publishes the Merkle checkpoint and the proof route proves an event against it", async (t) => {
  let role: "N1" | "N2" = "N1";
  let journal = sealAuditEvents(["e", "d", "c", "b", "a"].map(event));
  const app = express();
  const dependencies = {
    resolveActor: async () => ({ id: "user_x", role, serviceIds: [] }),
    loadAuditEvents: async () => journal,
  };
  app.get("/integrity", createItsmAuditIntegrityHandler(dependencies));
  app.get("/proof", createItsmAuditProofHandler(dependencies));
  const base = await serve(t, app);

  const report = await (await fetch(`${base}/integrity`)).json();
  assert.equal(report.merkle.size, 5);
  const kept = report.merkle;

  journal = sealAuditEvents([event("g"), event("f"), ...journal]);
  const byId = await fetch(`${base}/proof?event=c&treeSize=${kept.size}`);
  assert.equal(byId.status, 200);
  const proof = await byId.json();
  assert.equal(proof.seq, 3);
  assert.equal(proof.root, kept.root);
  assert.doesNotMatch(JSON.stringify(proof), /Action|user_a/);
  assert.ok(verifyMerkleInclusion(proof.seal, proof.seq - 1, proof.treeSize, proof.proof, kept.root));

  const bySeq = await (await fetch(`${base}/proof?event=7`)).json();
  assert.equal(bySeq.eventId, "g");
  assert.equal(bySeq.treeSize, 7);

  assert.equal((await fetch(`${base}/proof?event=c&treeSize=2`)).status, 400, "the event is after this checkpoint");
  assert.equal((await fetch(`${base}/proof?event=c&treeSize=99`)).status, 400);
  assert.equal((await fetch(`${base}/proof?event=c&treeSize=-1`)).status, 400);
  assert.equal((await fetch(`${base}/proof?event=inconnu`)).status, 404);
  assert.equal((await fetch(`${base}/proof`)).status, 400);

  // A broken chain gives no proof and no checkpoint.
  journal = journal.map((item) => (item.id === "b" ? { ...item, action: "réécrit" } : item));
  assert.equal((await fetch(`${base}/proof?event=c`)).status, 409);
  assert.equal((await (await fetch(`${base}/integrity`)).json()).merkle, null);

  role = "N2";
  assert.equal((await fetch(`${base}/proof?event=c`)).status, 403);
});
