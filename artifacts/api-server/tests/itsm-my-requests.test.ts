import test from "node:test";
import assert from "node:assert/strict";
import { verifyAuditChain } from "../src/lib/itsm-audit-chain.ts";
import { ItsmAuthorizationError } from "../src/lib/itsm-rbac.ts";
import {
  applyWorkspaceUpdate,
  createItsmMyRequest,
  decideItsmRequestApproval,
  itsmMyRequestsView,
  markItsmNotificationsRead,
  userStoreView,
  type WorkspaceActor,
} from "../src/lib/itsm-workspace.ts";

const requester: WorkspaceActor = { id: "requester-1", role: "REQUESTER", serviceIds: [] };
const support: WorkspaceActor = { id: "support-1", role: "N2", serviceIds: [] };
const at = new Date("2026-11-13T10:00:00.000Z");

function emptyWorkspace() {
  return {
    schema: 2,
    tickets: [],
    conversations: [],
    audit: [],
    kedb: [],
    services: [{ id: "service-1", name: "Support central", category: "Applications", status: "Actif", secret: "hidden" }],
    assets: [],
    notifications: [],
    seeded: [],
  };
}

test("requester view returns only tickets owned by the authenticated account", () => {
  const store = {
    ...emptyWorkspace(),
    tickets: [
      { id: "INC-1", kind: "Incident", title: "Ma demande", category: "Applications", status: "Nouveau", priority: "P4", serviceId: "service-1", description: "Mon poste ne démarre plus.", openedAt: at.toISOString(), requesterId: requester.id },
      { id: "INC-2", kind: "Incident", title: "Autre compte", category: "Applications", status: "Nouveau", priority: "P3", serviceId: "service-1", description: "Autre demande.", openedAt: at.toISOString(), requesterId: "someone-else" },
      { id: "INC-3", kind: "Incident", title: "Ancien exemple", category: "Applications", status: "Nouveau", priority: "P3", serviceId: "service-1", description: "Sans identifiant propriétaire.", openedAt: at.toISOString(), requester: requester.id },
    ],
  };

  const view = itsmMyRequestsView(store, requester) as {
    requests: Array<Record<string, unknown>>;
    services: Array<Record<string, unknown>>;
  };
  assert.deepEqual(view.requests.map((request) => request.id), ["INC-1"]);
  assert.deepEqual(view.services, [{ id: "service-1", name: "Support central", category: "Applications" }]);
  assert.equal("secret" in view.services[0]!, false);
});

test("new requester request gets server-owned identity, priority and audit seal", () => {
  const store = emptyWorkspace();
  const next = createItsmMyRequest(store, {
    kind: "Incident",
    title: "  Accès à l’application  ",
    category: "Applications",
    description: "  Le formulaire de connexion affiche une erreur.  ",
    serviceId: "service-1",
  }, requester, at);
  const ticket = (next.tickets as Array<Record<string, unknown>>)[0]!;
  assert.equal(ticket.title, "Accès à l’application");
  assert.equal(ticket.requester, requester.id);
  assert.equal(ticket.requesterId, requester.id);
  assert.equal(ticket.priority, "P4");
  assert.equal(ticket.status, "Nouveau");
  assert.equal(ticket.assignee, "Équipe support");
  assert.equal(ticket.openedAt, at.toISOString());
  assert.equal((next.audit as Array<Record<string, unknown>>)[0]?.type, "itsm.request.created");
  assert.equal(verifyAuditChain(next.audit).status, "intact");
  assert.deepEqual((itsmMyRequestsView(next, requester) as { requests: Array<{ id: string }> }).requests.map(({ id }) => id), [ticket.id]);
});

test("service demand waits for approval and pauses its SLA", () => {
  const next = createItsmMyRequest(emptyWorkspace(), {
    kind: "Demande",
    title: "Créer un accès",
    category: "Accès",
    description: "Créer un accès au portail de test.",
    serviceId: "service-1",
  }, requester, at);
  const ticket = (next.tickets as Array<Record<string, unknown>>)[0]!;
  assert.equal(ticket.status, "En attente");
  assert.deepEqual(ticket.requestApproval, { status: "pending" });
  assert.deepEqual(ticket.slaPauses, [{ startedAt: at.toISOString() }]);
  const view = itsmMyRequestsView(next, requester) as { requests: Array<Record<string, unknown>> };
  assert.deepEqual(view.requests[0]?.requestApproval, { status: "pending", reason: null, decidedAt: null });

  assert.throws(() => applyWorkspaceUpdate(next, {
    ...next,
    tickets: [{ ...ticket, status: "Pris en compte" }],
  }, support, at), /doit d’abord être approuvée ou rejetée/);
});

test("N1 can approve a service demand and its SLA pause ends", () => {
  const pending = createItsmMyRequest(emptyWorkspace(), {
    kind: "Demande",
    title: "Créer un accès",
    category: "Accès",
    description: "Créer un accès au portail de test.",
    serviceId: "service-1",
  }, requester, at);
  const requestId = String((pending.tickets as Array<Record<string, unknown>>)[0]?.id);
  const n1: WorkspaceActor = { id: "approver-n1", role: "N1", serviceIds: [] };
  const decidedAt = new Date("2026-11-13T11:00:00.000Z");
  const next = decideItsmRequestApproval(pending, requestId, { decision: "approve" }, n1, decidedAt);
  const ticket = (next.tickets as Array<Record<string, unknown>>)[0]!;
  assert.equal(ticket.status, "Nouveau");
  assert.deepEqual(ticket.requestApproval, { status: "approved", decidedAt: decidedAt.toISOString(), reason: null });
  assert.deepEqual(ticket.slaPauses, [{ startedAt: at.toISOString(), endedAt: decidedAt.toISOString() }]);
  assert.equal((next.audit as Array<Record<string, unknown>>)[0]?.type, "itsm.request.approved");
  assert.equal(verifyAuditChain(next.audit).status, "intact");
});

test("N3 approval is limited to assigned services and rejection requires a reason", () => {
  const pending = createItsmMyRequest(emptyWorkspace(), {
    kind: "Demande",
    title: "Créer un accès",
    category: "Accès",
    description: "Créer un accès au portail de test.",
    serviceId: "service-1",
  }, requester, at);
  const requestId = String((pending.tickets as Array<Record<string, unknown>>)[0]?.id);
  const n3Other: WorkspaceActor = { id: "approver-n3-other", role: "N3", serviceIds: ["service-2"] };
  const n3Assigned: WorkspaceActor = { id: "approver-n3", role: "N3", serviceIds: ["service-1"] };
  assert.throws(() => decideItsmRequestApproval(pending, requestId, { decision: "approve" }, n3Other, at), ItsmAuthorizationError);
  assert.throws(() => decideItsmRequestApproval(pending, requestId, { decision: "reject" }, n3Assigned, at), /motif est obligatoire/);
  const rejected = decideItsmRequestApproval(pending, requestId, {
    decision: "reject",
    reason: "Validation métier nécessaire.",
  }, n3Assigned, at);
  const ticket = (rejected.tickets as Array<Record<string, unknown>>)[0]!;
  assert.equal(ticket.status, "Rejeté");
  assert.equal(ticket.closedAt, at.toISOString());
  assert.deepEqual(ticket.requestApproval, {
    status: "rejected",
    decidedAt: at.toISOString(),
    reason: "Validation métier nécessaire.",
  });
  assert.equal((rejected.audit as Array<Record<string, unknown>>)[0]?.type, "itsm.request.rejected");
});

test("only the requester role can read or create self-service requests", () => {
  assert.throws(() => itsmMyRequestsView(emptyWorkspace(), support), ItsmAuthorizationError);
  assert.throws(() => createItsmMyRequest(emptyWorkspace(), {
    kind: "Demande",
    title: "Créer un accès",
    category: "Accès",
    description: "Créer un accès au portail de test.",
    serviceId: null,
  }, support, at), ItsmAuthorizationError);
});

test("requester cannot select a service outside the shared catalog", () => {
  assert.throws(() => createItsmMyRequest(emptyWorkspace(), {
    kind: "Demande",
    title: "Créer un accès",
    category: "Accès",
    description: "Créer un accès au portail de test.",
    serviceId: "not-in-catalog",
  }, requester, at), /Service associé introuvable/);
});

test("notification read state persists per account and stays inside each role's visible scope", () => {
  const store = {
    ...emptyWorkspace(),
    tickets: [
      { id: "INC-1", serviceId: "service-1" },
      { id: "INC-2", serviceId: "service-2" },
    ],
    conversations: [{
      id: "C-1", kind: "Direct", classification: "Interne", participants: ["user_n3", "user_n4"],
      messages: [{ id: "m-1", author: "user_n3", body: "Bonjour" }],
    }],
    notifications: [
      { id: "notice-1", ticketId: "INC-1" },
      { id: "notice-2", ticketId: "INC-2" },
    ],
    notificationReads: {
      "support-1": ["notice-1", "INC-1:ack:2030-01-01T00:00:00.000Z", "mention:m-1"],
      user_n4: ["notice-2", "INC-2:res:2030-01-02T00:00:00.000Z", "mention:m-1", "INC-1:ack:2030-01-01T00:00:00.000Z"],
    },
  };
  const next = markItsmNotificationsRead(store, ["notice-3", "notice-3", "", "x".repeat(257)], support);
  assert.deepEqual((next.notificationReads as Record<string, string[]>)["support-1"], [
    "notice-1", "INC-1:ack:2030-01-01T00:00:00.000Z", "mention:m-1", "notice-3",
  ]);
  assert.deepEqual((next.notificationReads as Record<string, string[]>).user_n4, store.notificationReads.user_n4);
  const n3View = userStoreView(next, support);
  assert.deepEqual(n3View.notifRead, (next.notificationReads as Record<string, string[]>)["support-1"]);
  const n4View = userStoreView(next, { id: "user_n4", role: "N4", serviceIds: ["service-1"] });
  assert.deepEqual(n4View.notifRead, ["INC-1:ack:2030-01-01T00:00:00.000Z"]);
  assert.throws(() => markItsmNotificationsRead(next, ["notice-1"], requester), ItsmAuthorizationError);
});

