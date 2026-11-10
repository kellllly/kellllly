import test from "node:test";
import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseCertificates, resolveConfigFile } from "../src/lib/itsm-audit-timestamp.ts";

/**
 * Racine de confiance de l'autorité d'horodatage (ITSM_TSA_TRUSTED_CERTS_FILE =
 * certs/freetsa-cacert.pem). Empreintes vérifiées le 2026-11-10 contre celles
 * publiées sur https://freetsa.org/index_en.php : un certificat remplacé ou
 * altéré fait échouer ce test.
 */
const FILE_SHA256 = "2151b61137ffa86bf664691ba67e7da0b19f98c758e3d228d5d8ebf27e044438";
const CERT_SHA256 = "A6:37:9E:7C:EC:C0:5F:AA:3C:BF:07:60:13:D7:45:E3:27:BB:BA:A3:8C:0B:9A:F2:24:69:D4:70:1D:18:AA:BC";

test("the configured FreeTSA root is the one published by FreeTSA", () => {
  const path = resolveConfigFile("certs/freetsa-cacert.pem");
  const pem = readFileSync(path, "utf8");
  assert.equal(createHash("sha256").update(pem).digest("hex"), FILE_SHA256, "empreinte du fichier publiée sur freetsa.org");
  const certificate = new X509Certificate(pem);
  assert.equal(certificate.fingerprint256, CERT_SHA256);
  assert.match(certificate.subject, /CN=www\.freetsa\.org/u);
  assert.equal(certificate.ca, true, "certificat d'autorité");
  assert.ok(Date.parse(certificate.validTo) > Date.now(), "encore valide");
  assert.equal(parseCertificates(pem).length, 1, "lu par l'API");
});
