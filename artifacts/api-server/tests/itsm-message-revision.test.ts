import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { applyWorkspaceUpdate, purgeExpiredMessages, reviseMessage } from "../src/lib/itsm-workspace.ts";
import { ItsmAuthorizationError } from "../src/lib/itsm-rbac.ts";

type Rec = Record<string, any>;
const t0 = new Date("2026-11-12T10:00:00.000Z");
const later = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);
const analyst = { id: "user_analyst", role: "N2" as const, serviceIds: [] };
const other = { id: "user_other", role: "N2" as const, serviceIds: [] };
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** A team conversation holding one message sent by the analyst at t0. */
function sent() {
  const current = { tickets: [], services: [], assets: [], kedb: [], notifications: [], audit: [], conversations: [
    { id: "C-1", title: "Équipe", kind: "Équipe", classification: "Interne", participants: [], readCount: 0, messages: [] },
  ] };
  const next = applyWorkspaceUpdate(current, { ...current, conversations: [{ ...current.conversations[0], messages: [{ body: "Réunion à 10 h" }] }] }, analyst, t0) as Rec;
  return { store: next, id: next.conversations[0].messages[0].id as string };
}
const message = (store: Rec) => store.conversations[0].messages[0];

test("the author corrects a message within 5 minutes: earlier text kept in the message, hashes in the journal", () => {
  const { store, id } = sent();
  const once = reviseMessage(store, "C-1", id, { body: " Réunion à 11 h " }, analyst, later(2)) as Rec;
  assert.equal(message(once).body, "Réunion à 11 h");
  assert.equal(message(once).editedAt, later(2).toISOString());
  assert.deepEqual(message(once).revisions, [{ body: "Réunion à 10 h", at: message(store).at }]);
  const [event] = once.audit;
  assert.equal(event.type, "itsm.message.edited");
  assert.deepEqual([event.actor, event.conversationId, event.messageId], ["user_analyst", "C-1", id]);
  assert.deepEqual([event.beforeSha256, event.afterSha256], [sha("Réunion à 10 h"), sha("Réunion à 11 h")]);
  assert.ok(!JSON.stringify(event).includes("Réunion"), "the journal never copies message text");

  const twice = reviseMessage(once, "C-1", id, { body: "Réunion à 12 h" }, analyst, later(4)) as Rec;
  assert.deepEqual(message(twice).revisions.map((r: Rec) => [r.body, r.at]), [["Réunion à 10 h", message(store).at], ["Réunion à 11 h", later(2).toISOString()]]);
  assert.equal(store.conversations[0].messages[0].body, "Réunion à 10 h", "the input store is not mutated");
});

test("after 5 minutes a message can no longer be corrected, but can still be deleted", () => {
  const { store, id } = sent();
  assert.throws(() => reviseMessage(store, "C-1", id, { body: "Trop tard" }, analyst, later(5.1)), /délai de modification de 5 minutes/);
  const gone = reviseMessage(store, "C-1", id, { delete: true }, analyst, later(60)) as Rec;
  assert.deepEqual(message(gone), { id, author: "user_analyst", at: message(store).at, time: message(store).time, deleted: true, deletedAt: later(60).toISOString(), body: "" });
  assert.equal(gone.audit[0].type, "itsm.message.deleted");
  assert.equal(gone.audit[0].beforeSha256, sha("Réunion à 10 h"));
  assert.equal("afterSha256" in gone.audit[0], false);
  assert.throws(() => reviseMessage(gone, "C-1", id, { delete: true }, analyst, later(61)), /n’existe plus/);
  assert.throws(() => reviseMessage(gone, "C-1", id, { body: "Retour" }, analyst, later(61)), /n’existe plus/);
});

test("only the author may change a message, and the body is validated", () => {
  const { store, id } = sent();
  assert.throws(() => reviseMessage(store, "C-1", id, { body: "Piraté" }, other, later(1)), ItsmAuthorizationError);
  assert.throws(() => reviseMessage(store, "C-1", id, { delete: true }, other, later(1)), ItsmAuthorizationError);
  assert.throws(() => reviseMessage(store, "C-1", "missing", { delete: true }, analyst, later(1)), ItsmAuthorizationError);
  assert.throws(() => reviseMessage(store, "C-404", id, { delete: true }, analyst, later(1)), ItsmAuthorizationError);
  assert.throws(() => reviseMessage(store, "C-1", id, { body: "  " }, analyst, later(1)), /vide ou trop long/);
  assert.throws(() => reviseMessage(store, "C-1", id, { body: "x".repeat(5001) }, analyst, later(1)), /vide ou trop long/);
  assert.throws(() => reviseMessage(store, "C-1", id, { body: 42 }, analyst, later(1)), /vide ou trop long/);
  assert.throws(() => reviseMessage(store, "C-1", id, { body: "Réunion à 10 h" }, analyst, later(1)), /identique/);
});

test("a message converted into an incident is frozen", () => {
  const { store, id } = sent();
  const converted = { ...store, tickets: [{ id: "INC-1", sourceMessageId: id }] };
  assert.throws(() => reviseMessage(converted, "C-1", id, { body: "Autre" }, analyst, later(1)), /converti en incident/);
  assert.throws(() => reviseMessage(converted, "C-1", id, { delete: true }, analyst, later(1)), /converti en incident/);
});

test("the workspace save still refuses to rewrite a message; a revised history is accepted as is", () => {
  const { store, id } = sent();
  const tampered = structuredClone(store);
  tampered.conversations[0].messages[0].body = "Réécrit";
  assert.throws(() => applyWorkspaceUpdate(store, tampered, analyst, later(1)), /ne peut pas être réécrit/);
  const revised = reviseMessage(store, "C-1", id, { body: "Corrigé" }, analyst, later(1)) as Rec;
  const saved = applyWorkspaceUpdate(revised, structuredClone(revised), analyst, later(2)) as Rec;
  assert.equal(message(saved).body, "Corrigé");
  assert.equal(message(saved).revisions.length, 1);
});

test("a reply keeps a reference to an earlier message of the conversation, never a copy of its text", () => {
  const { store, id } = sent();
  const reply = (replyToId: unknown, base: Rec = store) => {
    const next = structuredClone(base);
    next.conversations[0].messages.push({ body: "D’accord", replyToId });
    return (applyWorkspaceUpdate(base, next, other, later(1)) as Rec).conversations[0].messages.at(-1);
  };
  const answer = reply(id);
  assert.equal(answer.replyToId, id);
  assert.ok(!JSON.stringify(answer).includes("Réunion"), "the quoted text is not copied");
  assert.equal("replyToId" in reply("inconnu"), false, "unknown message: reference dropped");
  assert.equal("replyToId" in reply(42), false);
  const gone = reviseMessage(store, "C-1", id, { delete: true }, analyst, later(1)) as Rec;
  assert.equal("replyToId" in reply(id, gone), false, "a deleted message cannot be quoted");
});

test("members pin up to 5 live messages; each pin and unpin is journaled", () => {
  const { store, id } = sent();
  const pin = (base: Rec, pinnedIds: unknown, who = analyst) => {
    const next = structuredClone(base);
    next.conversations[0].pinnedIds = pinnedIds;
    return applyWorkspaceUpdate(base, next, who, later(1)) as Rec;
  };
  const pinned = pin(store, [id]);
  assert.deepEqual(pinned.conversations[0].pinnedIds, [id]);
  assert.deepEqual([pinned.audit[0].type, pinned.audit[0].messageId, pinned.audit[0].pinned], ["itsm.message.pinned", id, true]);
  assert.match(pinned.audit[0].action, /épinglé dans la conversation C-1/);
  const kept = applyWorkspaceUpdate(pinned, structuredClone(pinned), analyst, later(2)) as Rec;
  assert.equal(kept.audit.length, pinned.audit.length, "an unchanged pin list adds nothing to the journal");
  const unpinned = pin(pinned, [], other);
  assert.equal("pinnedIds" in unpinned.conversations[0], false);
  assert.equal(unpinned.audit[0].pinned, false);
  assert.match(unpinned.audit[0].action, /désépinglé/);

  for (const bad of ["x", [42]]) assert.throws(() => pin(store, bad), /épinglés est invalide/);
  assert.deepEqual(pin(store, [id, id, "pas-encore-enregistré"]).conversations[0].pinnedIds, [id], "duplicates and unknown references dropped");
  const many = structuredClone(store);
  many.conversations[0].messages.push(...Array.from({ length: 5 }, (_, i) => ({ body: `M${i}` })));
  const six = applyWorkspaceUpdate(store, many, analyst, later(1)) as Rec;
  assert.throws(() => pin(six, six.conversations[0].messages.map((m: Rec) => m.id)), /au plus 5/);
});

test("a deleted or expired message is unpinned; only the Direction pins announcements", () => {
  const { store, id } = sent();
  const next = structuredClone(store);
  next.conversations[0].pinnedIds = [id];
  const pinned = applyWorkspaceUpdate(store, next, analyst, later(1)) as Rec;
  const gone = reviseMessage(pinned, "C-1", id, { delete: true }, analyst, later(2)) as Rec;
  assert.equal("pinnedIds" in gone.conversations[0], false);

  const ephemeral = structuredClone(pinned);
  ephemeral.conversations[0].messages[0].expiresAt = later(3).toISOString();
  const purged = purgeExpiredMessages(ephemeral, later(4)).store as Rec;
  assert.equal("pinnedIds" in purged.conversations[0], false);

  const announcements = { ...structuredClone(store), conversations: [{ id: "C-A", title: "Annonces", kind: "Annonce", classification: "Interne", participants: [], readCount: 0, messages: [{ id: "a1", author: "user_director", body: "Info", system: true, at: t0.toISOString(), time: "10:00" }] }] };
  const proposal = structuredClone(announcements);
  proposal.conversations[0].pinnedIds = ["a1"];
  assert.throws(() => applyWorkspaceUpdate(announcements, proposal, analyst, later(1)), ItsmAuthorizationError);
  const director = { id: "user_director", role: "N1" as const, serviceIds: [] };
  assert.deepEqual((applyWorkspaceUpdate(announcements, proposal, director, later(1)) as Rec).conversations[0].pinnedIds, ["a1"]);
});

test("a forward is certified only from an internal conversation, with the original text and author", () => {
  const room = (id: string, extra: Rec = {}) => ({ id, title: id, kind: "Équipe", classification: "Interne", participants: [], readCount: 0, messages: [], ...extra });
  const original = (id: string, extra: Rec = {}) => ({ id, author: "user_other", body: `Texte ${id}`, at: t0.toISOString(), time: "10:00", ...extra });
  const base: Rec = { tickets: [], services: [], assets: [], kedb: [], notifications: [], audit: [], conversations: [
    room("C-SRC", { messages: [original("o1"), original("o2", { expiresAt: later(60).toISOString(), ttlSeconds: 3600 }), original("o3", { deleted: true, body: "" })] }),
    room("C-DST"),
    room("C-RES", { classification: "Restreint", messages: [original("r1")] }),
    room("C-TMP", { kind: "Temporaire", classification: "Restreint", memberIds: ["user_analyst"], expiresAt: later(600).toISOString() }),
  ] };
  const forward = (target: string, conversationId: string, messageId: string) => {
    const next = structuredClone(base);
    next.conversations.find((c: Rec) => c.id === target).messages.push({ body: "texte forgé par le navigateur", forwardOf: { conversationId, messageId } });
    const saved = applyWorkspaceUpdate(base, next, analyst, later(1)) as Rec;
    return { message: saved.conversations.find((c: Rec) => c.id === target).messages.at(-1), audit: saved.audit as Rec[] };
  };
  const { message: ok, audit } = forward("C-DST", "C-SRC", "o1");
  assert.equal(ok.body, "Texte o1", "the text comes from the original, not from the browser");
  assert.deepEqual(ok.forwardedFrom, { conversationId: "C-SRC", messageId: "o1", author: "user_other", at: t0.toISOString() });
  assert.equal("forwardOf" in ok, false);
  assert.deepEqual([audit[0].type, audit[0].sourceConversationId, audit[0].sourceMessageId, audit[0].conversationId], ["itsm.message.forwarded", "C-SRC", "o1", "C-DST"]);
  assert.ok(!JSON.stringify(audit[0]).includes("Texte o1"), "the journal does not copy the text");

  for (const [target, from, id, why] of [
    ["C-DST", "C-RES", "r1", "restricted source"], ["C-TMP", "C-SRC", "o1", "temporary target open to external members"],
    ["C-DST", "C-SRC", "o2", "ephemeral original"], ["C-DST", "C-SRC", "o3", "deleted original"],
    ["C-SRC", "C-SRC", "o1", "same conversation"], ["C-DST", "C-SRC", "inconnu", "unknown message"],
  ]) {
    const { message, audit: events } = forward(target!, from!, id!);
    assert.equal("forwardedFrom" in message, false, why);
    assert.equal(message.body, "texte forgé par le navigateur", `${why}: an ordinary message, not certified`);
    assert.ok(!events.some((event) => event.type === "itsm.message.forwarded"), why);
  }
});
