import test from "node:test";
import assert from "node:assert/strict";
import { checkAttachment, sanitizeAttachment } from "../src/lib/itsm-attachments.ts";
import { applyWorkspaceUpdate, purgeExpiredMessages, userStoreView } from "../src/lib/itsm-workspace.ts";

const hash = "a".repeat(64);
const pdf = { name: "note-de-service.pdf", type: "application/pdf", size: 120_000, sha256: hash };

test("usual documents pass without warning; executables and scripts are refused", () => {
  assert.deepEqual(checkAttachment("rapport.pdf", "application/pdf", 10), { blocked: null, warnings: [] });
  assert.deepEqual(checkAttachment("tableau.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 10).warnings, []);
  for (const name of ["setup.exe", "macro.vbs", "outil.ps1", "releve.pdf.exe", "raccourci.lnk"]) {
    assert.ok(checkAttachment(name, "", 10).blocked, name);
  }
  assert.ok(checkAttachment("enorme.pdf", "application/pdf", 26 * 1024 * 1024).blocked);
});

test("unusual or risky formats carry a pedagogical warning", () => {
  const warns = (name: string, type = "") => checkAttachment(name, type, 10).warnings.join(" ");
  assert.match(warns("budget.xlsm"), /macros/);
  assert.match(warns("pieces.zip"), /Archive/);
  assert.match(warns("page.html"), /scripts/);
  assert.match(warns("fichier.xyz"), /inhabituel/);
  assert.match(warns("SANSEXTENSION"), /sans extension/);
  assert.match(warns("releve.pdf.zip"), /Double extension/);
  assert.match(warns("scan.pdf", "image/png"), /ne correspond pas/);
  assert.match(warns("photo.jpg", "image/jpeg"), /EXIF/);
});

test("the server refuses malformed, blocked or unconfirmed attachments and recomputes the warnings", () => {
  assert.equal(sanitizeAttachment(undefined), undefined);
  assert.deepEqual(sanitizeAttachment(pdf), { ...pdf, warnings: [] });
  assert.throws(() => sanitizeAttachment({ ...pdf, sha256: "xyz" }), /Empreinte/);
  assert.throws(() => sanitizeAttachment({ ...pdf, name: "../etc/passwd" }), /Nom/);
  assert.throws(() => sanitizeAttachment({ ...pdf, name: "outil.exe" }), /interdit/);
  assert.throws(() => sanitizeAttachment({ ...pdf, name: "budget.xlsm", type: "" }), /confirmé/);
  const confirmed = sanitizeAttachment({ ...pdf, name: "budget.xlsm", type: "", acknowledged: true, warnings: [] })!;
  assert.match(String((confirmed.warnings as string[])[0]), /macros/, "client warnings are ignored");
  assert.equal("content" in sanitizeAttachment({ ...pdf, content: "base64…" })!, false, "no file content is kept");
});

test("a message keeps only the attachment description, and loses it when it expires", () => {
  const actor = { id: "user_n2", role: "N2" as const, serviceIds: [] };
  const current = { tickets: [], services: [], assets: [], kedb: [], notifications: [], audit: [], conversations: [
    { id: "C-1", title: "Équipe", kind: "Équipe", classification: "Interne", participants: [], readCount: 0, messages: [] },
  ] };
  const view = structuredClone(userStoreView(current, actor)) as { conversations: Array<{ messages: unknown[] }> };
  view.conversations[0]!.messages.push({ id: "m", body: "Voir pièce jointe", time: "", ttlSeconds: 30, attachment: { ...pdf, content: "secret" } });
  const saved = applyWorkspaceUpdate(current, view, actor, new Date("2026-11-08T10:00:00Z"));
  const message = (saved.conversations as Array<{ messages: Array<Record<string, unknown>> }>)[0]!.messages[0]!;
  assert.deepEqual(message.attachment, { ...pdf, warnings: [] });
  const forged = structuredClone(userStoreView(current, actor)) as { conversations: Array<{ messages: unknown[] }> };
  forged.conversations[0]!.messages.push({ id: "m", body: "x", time: "", attachment: { ...pdf, name: "virus.exe" } });
  assert.throws(() => applyWorkspaceUpdate(current, forged, actor), /interdit/);
  const purged = purgeExpiredMessages(saved, new Date("2026-11-08T10:01:00Z")).store;
  const expired = (purged.conversations as Array<{ messages: Array<Record<string, unknown>> }>)[0]!.messages[0]!;
  assert.equal("attachment" in expired, false);
});
