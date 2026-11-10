/**
 * RFC 3161 timestamps against a real local timestamp authority: `openssl ts`
 * signs the requests built by the pilot, so the request encoding, the token
 * parsing and the signature checks are exercised end to end, without network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { sealAuditEvents } from "../src/lib/itsm-audit-chain.ts";
import {
  buildTimestampRequest, checkpointDigest, checkpointStatement, parseCertificates, requestNonce, resolveConfigFile, verifyTimestamp,
} from "../src/lib/itsm-audit-timestamp.ts";
import { merkleRoot } from "../src/lib/itsm-audit-merkle.ts";
import { recordItsmAuditTimestamp, userStoreView } from "../src/lib/itsm-workspace.ts";
import {
  createItsmAuditTimestampHandler, createItsmAuditTimestampListHandler, createItsmAuditTimestampTokenHandler, orderedSeals,
} from "../src/routes/itsm-audit-export.ts";

const hasOpenssl = (() => { try { execFileSync("openssl", ["version"]); return true; } catch { return false; } })();
const openssl = (dir: string, args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });

/** A throwaway CA and TSA, and a second signer whose certificate is not a timestamping one. */
function makeAuthority() {
  const dir = mkdtempSync(join(tmpdir(), "anif-tsa-"));
  writeFileSync(join(dir, "tsa.cnf"), `
[ req ]
distinguished_name = dn
prompt = no
[ dn ]
CN = ANIF Test TSA
[ tsa_ext ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,timeStamping
[ plain_ext ]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
[ ca_ext ]
basicConstraints = critical,CA:true
keyUsage = critical,keyCertSign,cRLSign
[ tsa ]
default_tsa = good
[ good ]
serial = ./serial
signer_cert = ./tsa.crt
certs = ./tsa.crt
signer_key = ./tsa.key
signer_digest = sha256
default_policy = 1.3.6.1.4.1.99999.1
digests = sha256
ess_cert_id_alg = sha256
[ plain ]
serial = ./serial
signer_cert = ./plain.crt
certs = ./plain.crt
signer_key = ./plain.key
signer_digest = sha256
default_policy = 1.3.6.1.4.1.99999.1
digests = sha256
ess_cert_id_alg = sha256
`);
  writeFileSync(join(dir, "serial"), "01\n");
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"];
  openssl(dir, ["req", "-x509", ...ec, "-keyout", "ca.key", "-out", "ca.crt", "-days", "30", "-subj", "/CN=ANIF Test Root", "-extensions", "ca_ext", "-config", "tsa.cnf"]);
  openssl(dir, ["req", "-x509", ...ec, "-keyout", "other.key", "-out", "other.crt", "-days", "30", "-subj", "/CN=Other Root", "-extensions", "ca_ext", "-config", "tsa.cnf"]);
  for (const [name, ext] of [["tsa", "tsa_ext"], ["plain", "plain_ext"]] as const) {
    openssl(dir, ["req", "-new", ...ec, "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=ANIF ${name}`, "-config", "tsa.cnf"]);
    openssl(dir, ["x509", "-req", "-in", `${name}.csr`, "-CA", "ca.crt", "-CAkey", "ca.key", "-CAcreateserial", "-out", `${name}.crt`, "-days", "30", "-extfile", "tsa.cnf", "-extensions", ext]);
  }
  const sign = (request: Buffer, section = "good") => {
    writeFileSync(join(dir, "req.tsq"), request);
    openssl(dir, ["ts", "-reply", "-queryfile", "req.tsq", "-config", "tsa.cnf", "-section", section, "-out", "resp.tsr"]);
    return readFileSync(join(dir, "resp.tsr"));
  };
  return { dir, sign, root: parseCertificates(readFileSync(join(dir, "ca.crt"), "utf8")), other: parseCertificates(readFileSync(join(dir, "other.crt"), "utf8")) };
}

test("tokens signed by a real TSA verify, and every forgery is refused", { skip: !hasOpenssl && "openssl absent" }, async () => {
  const tsa = makeAuthority();
  const statement = Buffer.from(checkpointStatement(5, "a".repeat(64)));
  const request = buildTimestampRequest(checkpointDigest(5, "a".repeat(64)));
  const nonce = requestNonce(request);
  const token = tsa.sign(request);

  const plain = await verifyTimestamp(token, statement, { nonce });
  assert.equal(plain.valid, true, plain.problem ?? "");
  assert.equal(plain.chainVerified, false, "no trusted root configured: the chain is not claimed");
  assert.match(plain.tsaSubject ?? "", /ANIF tsa/u);
  assert.ok(plain.genTime && Math.abs(Date.parse(plain.genTime) - Date.now()) < 120_000);

  assert.equal((await verifyTimestamp(token, statement, { nonce, trustedCerts: tsa.root })).chainVerified, true);
  assert.match((await verifyTimestamp(token, statement, { nonce, trustedCerts: tsa.other })).problem ?? "", /racine de confiance/u);
  assert.match((await verifyTimestamp(token, Buffer.from(checkpointStatement(5, "b".repeat(64))), { nonce })).problem ?? "", /empreinte/u);
  assert.match((await verifyTimestamp(token, statement, { nonce: "01ff" })).problem ?? "", /nonce/u);
  const tampered = Buffer.from(token); tampered[tampered.length - 20]! ^= 0xff;
  assert.equal((await verifyTimestamp(tampered, statement, { nonce })).valid, false);
  assert.match((await verifyTimestamp(Buffer.from("n’importe quoi"), statement)).problem ?? "", /illisible/u);
  // openssl itself refuses to sign with a certificate lacking the timeStamping usage
  // (the "plain" signer), so that forgery cannot be produced here; the check stays in the code.
  assert.throws(() => tsa.sign(request, "plain"));
});

const event = (id: string) => ({ id, action: `Action ${id}`, actor: "user_a", scope: "Pilote", time: "10:00", at: "2026-11-09T10:00:00.000Z" });

test("the routes timestamp the checkpoint, re-verify it, and expose a rewritten journal", { skip: !hasOpenssl && "openssl absent" }, async (t) => {
  const tsa = makeAuthority();
  const tsaServer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      assert.equal(req.headers["content-type"], "application/timestamp-query");
      res.writeHead(200, { "Content-Type": "application/timestamp-reply" }).end(tsa.sign(Buffer.concat(chunks)));
    });
  }).listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => tsaServer.close(() => resolve())));
  await new Promise<void>((resolve) => tsaServer.once("listening", resolve));
  const tsaAddress = tsaServer.address();
  assert.ok(tsaAddress && typeof tsaAddress !== "string");

  let store: Record<string, unknown> = { audit: sealAuditEvents(["c", "b", "a"].map(event)) };
  let role: "N1" | "N3" | "N5" | "N2" = "N1";
  const dependencies = {
    resolveActor: async () => ({ id: "user_x", role, serviceIds: [] }),
    loadAuditEvents: async () => store.audit as unknown[],
    tsaUrl: `http://127.0.0.1:${tsaAddress.port}/tsr`,
    trustedCerts: tsa.root,
    appendTimestamp: async (entry: { actorId: string; size: number; root: string; token: string; verification: { genTime: string | null; serial: string | null; policy: string | null; tsaSubject: string | null } }) => {
      const seals = orderedSeals(store.audit as unknown[]);
      if (merkleRoot(seals, entry.size) !== entry.root) return "changed" as const;
      store = recordItsmAuditTimestamp(store, { ...entry, tsaUrl: "test", ...entry.verification });
      return "saved" as const;
    },
  };
  const app = express();
  app.get("/ts", createItsmAuditTimestampListHandler(dependencies));
  app.post("/ts", createItsmAuditTimestampHandler(dependencies));
  app.get("/ts/:id/token", createItsmAuditTimestampTokenHandler(dependencies));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/ts`;

  const created = await fetch(base, { method: "POST" });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).size, 3);

  // New events after the checkpoint do not invalidate it.
  store = { ...store, audit: sealAuditEvents([event("d"), ...(store.audit as Record<string, unknown>[])]) };
  let list = await (await fetch(base)).json();
  assert.equal(list.configured, true);
  const [stamp] = list.timestamps;
  assert.deepEqual([stamp.valid, stamp.chainVerified, stamp.journalUnchanged, stamp.size], [true, true, true, 3]);
  assert.equal(stamp.statement, checkpointStatement(3, stamp.root));

  // The token downloads as DER and openssl verifies it against the statement.
  const token = Buffer.from(await (await fetch(`${base}/${stamp.id}/token`)).arrayBuffer());
  writeFileSync(join(tsa.dir, "statement.txt"), stamp.statement);
  writeFileSync(join(tsa.dir, "downloaded.tsr"), token);
  assert.match(openssl(tsa.dir, ["ts", "-verify", "-data", "statement.txt", "-in", "downloaded.tsr", "-CAfile", "ca.crt", "-untrusted", "tsa.crt"]).toString(), /Verification: OK/u);
  // The browser view does not carry the token.
  assert.equal(JSON.stringify(userStoreView(store, { id: "user_x", role: "N1", serviceIds: [] })).includes(token.toString("base64").slice(0, 40)), false);

  // Someone with database access rewrites event "a" and recomputes the whole chain: the seals
  // are consistent again, but the first 3 events no longer give the timestamped root.
  const rewritten = (store.audit as Record<string, unknown>[]).map(({ seq: _s, prevHash: _p, hash: _h, ...rest }) =>
    (rest.id === "a" ? { ...rest, action: "Réécrit" } : rest));
  store = { ...store, audit: sealAuditEvents(rewritten) };
  list = await (await fetch(base)).json();
  assert.equal(list.timestamps[0].valid, true, "the token itself is still genuine");
  assert.equal(list.timestamps[0].journalUnchanged, false);
  assert.match(list.timestamps[0].problem, /réécrit/u);

  role = "N5";
  assert.equal((await fetch(base)).status, 200, "auditors read the timestamps");
  assert.equal((await fetch(base, { method: "POST" })).status, 403, "but cannot request one");
  role = "N2";
  assert.equal((await fetch(base)).status, 403);
  role = "N3";
  const unconfigured = express();
  unconfigured.post("/ts", createItsmAuditTimestampHandler({ ...dependencies, tsaUrl: undefined }));
  const bare = unconfigured.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve) => bare.close(() => resolve())));
  await new Promise<void>((resolve) => bare.once("listening", resolve));
  const bareAddress = bare.address();
  assert.ok(bareAddress && typeof bareAddress !== "string");
  assert.equal((await fetch(`http://127.0.0.1:${bareAddress.port}/ts`, { method: "POST" })).status, 503);
});

test("timestamp events are kept whole when old events are pruned", () => {
  const stamped = recordItsmAuditTimestamp({ audit: sealAuditEvents([event("a")]) }, {
    actorId: "user_x", size: 1, root: "f".repeat(64), tsaUrl: "test", token: "AAAA", genTime: null, serial: null, policy: null, tsaSubject: null,
  });
  let store: Record<string, unknown> = stamped;
  for (let i = 0; i < 3; i += 1) {
    store = recordItsmAuditTimestamp(store, { actorId: "u", size: 1, root: "f".repeat(64), tsaUrl: "t", token: "B", genTime: null, serial: null, policy: null, tsaSubject: null });
  }
  const audit = store.audit as Record<string, unknown>[];
  assert.ok(audit.every((item) => item.type !== "itsm.audit.timestamped" || typeof item.token === "string"));
});

test("a relative trusted-roots file is found from the workspace root when the API runs in its package", () => {
  const root = mkdtempSync(join(tmpdir(), "anif-root-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  execFileSync("mkdir", ["-p", join(root, "certs"), join(root, "artifacts", "api-server")]);
  writeFileSync(join(root, "certs", "ca.pem"), "x");
  assert.equal(resolveConfigFile("certs/ca.pem", join(root, "artifacts", "api-server")), join(root, "certs", "ca.pem"));
  writeFileSync(join(root, "artifacts", "api-server", "local.pem"), "x");
  assert.equal(resolveConfigFile("local.pem", join(root, "artifacts", "api-server")), join(root, "artifacts", "api-server", "local.pem"));
  assert.equal(resolveConfigFile("/abs/ca.pem", root), "/abs/ca.pem");
});
