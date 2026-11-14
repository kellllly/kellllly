import test from "node:test";
import assert from "node:assert/strict";
import {
  ItsmKnowledgeArticleNotFoundError,
  ItsmKnowledgeReviewConflictError,
  ItsmKnowledgeReviewValidationError,
  reviewItsmKnowledgeArticle,
  userStoreView,
} from "../src/lib/itsm-workspace.ts";
import { ItsmAuthorizationError } from "../src/lib/itsm-rbac.ts";
import type { WorkspaceActor } from "../src/lib/itsm-workspace.ts";

const at = new Date("2026-11-14T12:00:00.000Z");
const actor = (id: string, role: WorkspaceActor["role"], serviceIds: string[] = []): WorkspaceActor => ({ id, role, serviceIds });
const article = {
  id: "KEDB-REVIEW-1",
  title: "Certificat expiré",
  symptom: "La messagerie est inaccessible.",
  rootCause: "Le certificat du relais a expiré.",
  resolution: "Renouveler le certificat du relais.",
  ticketId: "INC-2401",
  serviceId: "service-mail",
  category: "Applications",
  createdAt: at.toISOString(),
  author: "user-agent",
  reviewStatus: "pending",
  reviewFeedback: null,
  reviewedAt: null,
  reviewedBy: null,
};
const store = () => ({ schema: 2, tickets: [], conversations: [], audit: [], kedb: [{ ...article }], services: [], assets: [], notifications: [], seeded: [] });

test("KEDB review publishes corrected content and records a server audit event", () => {
  const result = reviewItsmKnowledgeArticle(
    store(),
    article.id,
    { decision: "publish", title: "Renouveler le certificat SMTP" },
    actor("user-n1", "N1"),
    at,
  );

  assert.equal(result.article.reviewStatus, "published");
  assert.equal(result.article.title, "Renouveler le certificat SMTP");
  assert.equal(result.article.reviewedBy, "user-n1");
  assert.equal(result.article.reviewedAt, at.toISOString());
  assert.equal(result.article.reviewFeedback, null);
  assert.equal((result.store.kedb as Record<string, unknown>[])[0]?.reviewStatus, "published");
  assert.equal((result.store.audit as Record<string, unknown>[])[0]?.type, "itsm.kedb.published");
  assert.equal((result.store.audit as Record<string, unknown>[])[0]?.actor, "user-n1");
});

test("KEDB review requires an explanation to request changes and preserves the feedback", () => {
  assert.throws(
    () => reviewItsmKnowledgeArticle(store(), article.id, { decision: "request_changes" }, actor("user-n1", "N1"), at),
    ItsmKnowledgeReviewValidationError,
  );

  const result = reviewItsmKnowledgeArticle(
    store(),
    article.id,
    { decision: "request_changes", comment: "Ajouter les étapes de vérification du certificat." },
    actor("user-n1", "N1"),
    at,
  );
  assert.equal(result.article.reviewStatus, "needs_revision");
  assert.equal(result.article.reviewFeedback, "Ajouter les étapes de vérification du certificat.");
  assert.equal((result.store.audit as Record<string, unknown>[])[0]?.type, "itsm.kedb.changes_requested");
});

test("only N1 or an in-scope N3 can review a knowledge article", () => {
  const n3 = actor("user-n3", "N3", ["service-mail"]);
  const result = reviewItsmKnowledgeArticle(store(), article.id, { decision: "publish" }, n3, at);
  assert.equal(result.article.reviewStatus, "published");

  assert.throws(
    () => reviewItsmKnowledgeArticle(store(), article.id, { decision: "publish" }, actor("other-n3", "N3", ["service-other"]), at),
    ItsmAuthorizationError,
  );
  assert.throws(
    () => reviewItsmKnowledgeArticle(store(), article.id, { decision: "publish" }, actor("user-n2", "N2", ["service-mail"]), at),
    ItsmAuthorizationError,
  );
});

test("pending articles are visible only to reviewers in their service scope", () => {
  const current = store();
  assert.deepEqual((userStoreView(current, actor("user-n2", "N2")).kedb as unknown[]), []);
  assert.deepEqual((userStoreView(current, actor("user-n5", "N5")).kedb as unknown[]), []);
  assert.deepEqual((userStoreView(current, actor("user-n3", "N3", ["service-other"])).kedb as unknown[]), []);
  assert.equal((userStoreView(current, actor("user-n3", "N3", ["service-mail"])).kedb as Record<string, unknown>[]).length, 1);
  assert.equal((userStoreView(current, actor("user-n1", "N1")).kedb as Record<string, unknown>[]).length, 1);

  const published = { ...current, kedb: [{ ...article, reviewStatus: "published" }] };
  assert.equal((userStoreView(published, actor("user-n2", "N2")).kedb as unknown[]).length, 1);
  assert.equal((userStoreView(published, actor("user-n5", "N5")).kedb as unknown[]).length, 1);
});

test("published articles cannot be reviewed again and unknown articles return not found", () => {
  const published = { ...store(), kedb: [{ ...article, reviewStatus: "published" }] };
  assert.throws(
    () => reviewItsmKnowledgeArticle(published, article.id, { decision: "publish" }, actor("user-n1", "N1"), at),
    ItsmKnowledgeReviewConflictError,
  );
  assert.throws(
    () => reviewItsmKnowledgeArticle(store(), "missing", { decision: "publish" }, actor("user-n1", "N1"), at),
    ItsmKnowledgeArticleNotFoundError,
  );
});
