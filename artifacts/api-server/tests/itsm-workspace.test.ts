import test from "node:test";
import { verifyAuditChain } from "../src/lib/itsm-audit-chain.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyWorkspaceUpdate,
  ITSM_ROLE_CHANGE_AUDIT_TYPE,
  ITSM_TICKET_CONVERSION_AUDIT_TYPE,
  ItsmRoleArchiveUnavailableError,
  checkItsmRoleArchiveConnection,
  isDevelopmentDatabaseRoleArchiveEnabled,
  mergeLocalExamples,
  publishItsmRoleChangeToArchive,
  recordItsmRoleChange,
  saveWorkspaceAtVersion,
  userStoreView,
  ITSM_WORKSPACE_VERSION_CONFLICT_MESSAGE,
  workspaceVersionConflictResponse,
} from "../src/lib/itsm-workspace.ts";
import type { WorkspaceActor } from "../src/lib/itsm-workspace.ts";
import express from "express";
import pino from "pino";
import pinoHttp from "pino-http";
import { build } from "esbuild";
import { createItsmAuditExportHandler } from "../src/routes/itsm-audit-export.ts";
import {
  changedPaths,
  mergeSharedChanges,
  recoveryEditDetails,
  serverRefusalReason,
} from "../../anif-secure-desk/src/lib/sync-recovery.ts";

const at = new Date("2026-10-31T12:00:00.000Z");
async function withoutDevelopmentArchiveMode<T>(operation: () => Promise<T>): Promise<T> {
  const previousMode = process.env.ITSM_ROLE_ARCHIVE_MODE;
  delete process.env.ITSM_ROLE_ARCHIVE_MODE;
  try {
    return await operation();
  } finally {
    if (previousMode === undefined) delete process.env.ITSM_ROLE_ARCHIVE_MODE;
    else process.env.ITSM_ROLE_ARCHIVE_MODE = previousMode;
  }
}
const actor = (id: string, role: WorkspaceActor["role"] = "N3", serviceIds: string[] = ["service-1"]): WorkspaceActor =>
  ({ id, role, serviceIds });
const empty = () => ({
  schema: 2,
  tickets: [],
  conversations: [],
  audit: [],
  kedb: [],
  services: [],
  assets: [],
  notifications: [],
  seeded: [],
});
const conversionBrowserFixture = (messageId = "e2e-support-message") => {
  const message = {
    id: messageId,
    author: "Demandeur de test",
    body: "Signalement fictif isolé pour vérifier la conversion en incident.",
    time: "",
    at: "2026-01-15T10:00:00.000Z",
  };
  return {
    ...empty(),
    conversations: [{
      id: "e2e-conversion-support",
      kind: "Support",
      title: "Canal support isolé pour test",
      messages: [message],
      readCount: 1,
      participants: ["Demandeur de test", "Compte de test navigateur"],
      classification: "Interne",
    }],
  };
};
const candidateTicket = (id: string, kind = "Incident") => ({
  id,
  title: "Incident fictif de test",
  kind,
  category: "Applications",
  impact: 1,
  urgency: 1,
  priority: "P4",
  supportLevel: 2,
  status: "Clos",
  assignee: "Équipe support",
  requester: "usurpation",
  serviceId: null,
  assetId: null,
  openedAt: "2001-01-01T00:00:00.000Z",
  acknowledgedAt: "2001-01-01T00:00:00.000Z",
  resolvedAt: "2001-01-01T00:00:00.000Z",
  closedAt: "2001-01-01T00:00:00.000Z",
  description: "Description fictive pour le test serveur.",
  updates: [{ author: "usurpation", body: "historique imposé", at: "2001-01-01T00:00:00.000Z" }],
});

test("new shared tickets derive identity, priority, ID, and opening time on the server", () => {
  const submitted = { ...empty(), tickets: [candidateTicket("INC-2401")] };
  const next = applyWorkspaceUpdate(empty(), submitted, actor("user-a"), at);
  const ticket = next.tickets[0] as Record<string, any>;
  assert.equal(ticket.id, "INC-2401");
  assert.equal(ticket.requester, "user-a");
  assert.equal(ticket.priority, "P1");
  assert.equal(ticket.status, "Nouveau");
  assert.equal(ticket.openedAt, at.toISOString());
  assert.equal(ticket.acknowledgedAt, null);
  assert.equal(ticket.updates[0].author, "user-a");
  assert.equal(ticket.updates[0].at, at.toISOString());
  assert.equal(userStoreView(next, actor("user-b")).profile && (userStoreView(next, actor("user-b")).profile as any).name, "user-b");
});

test("role changes are recorded with server identity, roles, scope, and timestamp", () => {
  const store = {
    ...empty(),
    services: [{ id: "service-1", name: "Support central" }],
  };
  const next = recordItsmRoleChange(store, {
    actorId: "admin-1",
    targetUserId: "account-2",
    previousRole: "N5",
    nextRole: "N4",
    previousServiceIds: [],
    serviceIds: ["service-1"],
    scope: "Tous les services → Support central",
  }, at);
  const event = (next.audit as Record<string, any>[])[0];
  assert.equal(event.type, ITSM_ROLE_CHANGE_AUDIT_TYPE);
  assert.equal(event.actor, "admin-1");
  assert.equal(event.targetUserId, "account-2");
  assert.equal(event.previousRole, "N5");
  assert.equal(event.nextRole, "N4");
  assert.deepEqual(event.previousServiceIds, []);
  assert.deepEqual(event.serviceIds, ["service-1"]);
  assert.equal(event.scope, "Tous les services → Support central");
  assert.equal(event.at, at.toISOString());
  for (const role of ["N1", "N2", "N3", "N5"] as const) {
    assert.equal((userStoreView(next, actor(`reader-${role}`, role)).audit as Record<string, any>[])[0].id, event.id);
  }
  assert.deepEqual(userStoreView(next, actor("reader-N4", "N4")).audit, []);
});

test("old authorization events remain consultable beyond the 5,000-event journal limit", () => {
  const historicRoleEvent = {
    id: "historic-role-event",
    type: ITSM_ROLE_CHANGE_AUDIT_TYPE,
    action: "Habilitation modifiée",
    actor: "admin-historique",
    targetUserId: "account-historique",
    previousRole: "N5",
    nextRole: "N3",
    previousServiceIds: [],
    serviceIds: ["service-1"],
    scope: "Support central",
    at: "2020-01-01T00:00:00.000Z",
    time: "01:00",
  };
  const ordinaryEvents = Array.from({ length: 5_000 }, (_, index) => ({
    id: `ordinary-${index}`,
    action: `Événement ordinaire ${index}`,
  }));
  const initial = { ...empty(), audit: [...ordinaryEvents, historicRoleEvent] };
  const withNewRole = recordItsmRoleChange(initial, {
    actorId: "admin-recent",
    targetUserId: "account-recent",
    previousRole: "N5",
    nextRole: "N3",
    previousServiceIds: [],
    serviceIds: ["service-1"],
    scope: "Support central",
  }, at);
  const changedAudit = withNewRole.audit as Record<string, any>[];
  assert.equal(changedAudit.length, 5_002);
  assert.ok(changedAudit.some((event) => event.id === historicRoleEvent.id));

  const saved = applyWorkspaceUpdate(withNewRole, {
    ...withNewRole,
    audit: [{ id: "ordinary-new", action: "Nouvel événement ordinaire" }, ...changedAudit],
  }, actor("support", "N3"), at);
  const savedAudit = saved.audit as Record<string, any>[];

  // The oldest ordinary event keeps only its seal, so the hash chain stays verifiable.
  assert.equal(savedAudit.length, 5_003);
  assert.equal(savedAudit.filter((event) => event.pruned === true).length, 1);
  assert.equal(verifyAuditChain(savedAudit).status, "intact");
  assert.ok(savedAudit.some((event) => event.id === historicRoleEvent.id));
  assert.ok(savedAudit.some((event) => event.type === ITSM_ROLE_CHANGE_AUDIT_TYPE
    && event.targetUserId === "account-recent"));
  assert.ok(savedAudit.some((event) => event.action === "Nouvel événement ordinaire"));
  const prunedOldest = savedAudit.find((event) => event.id === ordinaryEvents[ordinaryEvents.length - 1].id);
  assert.equal(prunedOldest?.pruned, true);
  assert.equal(prunedOldest?.action, undefined, "a pruned event keeps no content");
  const auditorView = userStoreView(saved, actor("auditor", "N5")).audit as Record<string, any>[];
  assert.equal(auditorView.length, 5_002, "pruned stubs are not sent to the browser");
  assert.ok(auditorView.some((event) => event.id === historicRoleEvent.id));
});

test("role changes are sent to the configured external archive with stable event identity", async () => withoutDevelopmentArchiveMode(async () => {
  const event = (recordItsmRoleChange(empty(), {
    actorId: "admin-1",
    targetUserId: "account-2",
    previousRole: "N5",
    nextRole: "N4",
    previousServiceIds: [],
    serviceIds: ["service-1"],
    scope: "Tous les services → Support central",
  }, at).audit as Record<string, any>[])[0];
  let capturedUrl = "";
  let capturedHeaders: HeadersInit | undefined;
  let capturedBody: unknown;

  await publishItsmRoleChangeToArchive(event, {
    url: "https://siem.example.test/append",
    token: "test-token",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      capturedBody = JSON.parse(String(init?.body));
      return new Response(null, { status: 202 });
    },
  });

  assert.equal(capturedUrl, "https://siem.example.test/append");
  assert.equal(new Headers(capturedHeaders).get("Idempotency-Key"), event.id);
  assert.equal(new Headers(capturedHeaders).get("Authorization"), "Bearer test-token");
  assert.deepEqual(capturedBody, {
    schemaVersion: 1,
    source: "anif-secure-desk",
    event,
  });
}));

test("missing or unacknowledged external archives fail closed", async () => withoutDevelopmentArchiveMode(async () => {
  await assert.rejects(
    publishItsmRoleChangeToArchive({ id: "evt-1" } as any, { url: "" }),
    ItsmRoleArchiveUnavailableError,
  );
  await assert.rejects(
    publishItsmRoleChangeToArchive({ id: "evt-1" } as any, {
      url: "https://siem.example.test/append",
      fetchImpl: async () => new Response(null, { status: 503 }),
    }),
    ItsmRoleArchiveUnavailableError,
  );
}));

test("the local role archive mode is explicit and development-only", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousArchiveMode = process.env.ITSM_ROLE_ARCHIVE_MODE;
  try {
    process.env.NODE_ENV = "development";
    process.env.ITSM_ROLE_ARCHIVE_MODE = "development-db";
    assert.equal(isDevelopmentDatabaseRoleArchiveEnabled(), true);

    let attemptedExternalPublish = false;
    await publishItsmRoleChangeToArchive({ id: "local-event" } as any, {
      fetchImpl: async () => {
        attemptedExternalPublish = true;
        return new Response(null, { status: 503 });
      },
    });
    assert.equal(attemptedExternalPublish, false);

    process.env.NODE_ENV = "production";
    assert.throws(
      () => isDevelopmentDatabaseRoleArchiveEnabled(),
      /réservée à l’environnement de développement/,
    );
    await assert.rejects(
      publishItsmRoleChangeToArchive({ id: "production-event" } as any),
      /réservée à l’environnement de développement/,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousArchiveMode === undefined) delete process.env.ITSM_ROLE_ARCHIVE_MODE;
    else process.env.ITSM_ROLE_ARCHIVE_MODE = previousArchiveMode;
  }
});

test("archive connection check uses HEAD at the configured URL with the sender's bearer auth and no event body", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedHeaders: HeadersInit | undefined;
  let capturedBody: unknown;
  await checkItsmRoleArchiveConnection({
    url: "https://siem.example.test/append",
    token: "test-token",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedMethod = String(init?.method);
      capturedHeaders = init?.headers;
      capturedBody = init?.body;
      return new Response(null, { status: 204 });
    },
  });

  assert.equal(capturedUrl, "https://siem.example.test/append");
  assert.equal(capturedMethod, "HEAD");
  assert.equal(new Headers(capturedHeaders).get("Authorization"), "Bearer test-token");
  assert.equal(capturedBody, undefined);
});

test("archive connection check explains missing configuration, HTTP rejection, and timeout", async () => {
  await assert.rejects(
    checkItsmRoleArchiveConnection({ url: "" }),
    /L’URL de l’archive n’est pas configurée/,
  );
  await assert.rejects(
    checkItsmRoleArchiveConnection({
      url: "https://siem.example.test/append",
      fetchImpl: async () => new Response(null, { status: 401 }),
    }),
    /HTTP 401/,
  );
  await assert.rejects(
    checkItsmRoleArchiveConnection({
      url: "https://siem.example.test/append",
      timeoutMs: 1,
      fetchImpl: (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    }),
    /dépassé le délai/,
  );
});

test("browsers cannot create, alter, or import role-change audit events", () => {
  for (const eventType of ["itsm.role.changed", "itsm.role.attested"]) {
  const eventStore = recordItsmRoleChange(empty(), {
    actorId: "admin-1",
    targetUserId: "account-2",
    previousRole: "N5",
    nextRole: "N3",
    previousServiceIds: [],
    serviceIds: ["service-1"],
    scope: "Tous les services → Support central",
  }, at);
  const event = (eventStore.audit as Record<string, any>[])[0];
  event.type = eventType;
  const forged = { ...event, id: "forged-event", actor: "attacker" };
  assert.throws(() => applyWorkspaceUpdate(empty(), {
    ...empty(), audit: [forged],
  }, actor("writer", "N3"), at), /créés uniquement par le serveur/);

  const modified = { ...event, previousRole: "N1" };
  assert.throws(() => applyWorkspaceUpdate(eventStore, {
    ...eventStore, audit: [modified],
  }, actor("writer", "N3"), at), /ne peut pas être modifié/);

  const withoutEvent = applyWorkspaceUpdate(eventStore, {
    ...eventStore, audit: [],
  }, actor("writer", "N3"), at);
  assert.deepEqual(withoutEvent.audit, eventStore.audit);

  const imported = mergeLocalExamples(empty(), {
    ...empty(), audit: [forged],
  }, actor("writer", "N3"), at);
  assert.deepEqual(imported.audit.map((item: Record<string, any>) => item.type), [undefined]);
  assert.equal((imported.audit as Record<string, any>[]).some((item) => item.id === "forged-event"), false);
  }
});

test("server derives all nine impact and urgency priorities", () => {
  const expected = [
    ["P1", "P2", "P3"],
    ["P2", "P3", "P3"],
    ["P3", "P3", "P4"],
  ];
  for (let impact = 1; impact <= 3; impact++) {
    for (let urgency = 1; urgency <= 3; urgency++) {
      const result = applyWorkspaceUpdate(empty(), {
        ...empty(), tickets: [{ ...candidateTicket("client-id"), impact, urgency }],
      }, actor("user-a"), at);
      assert.equal((result.tickets[0] as Record<string, unknown>).priority, expected[impact - 1][urgency - 1]);
    }
  }
});

test("another authenticated session can see shared tickets but cannot forge the next author's identity", () => {
  const first = applyWorkspaceUpdate(empty(), { ...empty(), tickets: [candidateTicket("INC-2401")] }, actor("user-a"), at);
  const ticket = first.tickets[0] as Record<string, any>;
  const submitted = {
    ...first,
    tickets: [{
      ...ticket,
      updates: [...ticket.updates, { author: "user-a", body: "Note ajoutée par le second compte.", at: "1999-01-01T00:00:00.000Z" }],
    }],
  };
  const second = applyWorkspaceUpdate(first, submitted, actor("user-b"), at);
  const updated = second.tickets[0] as Record<string, any>;
  assert.equal(updated.id, ticket.id);
  assert.equal(updated.updates.at(-1).author, "user-b");
  assert.equal(updated.updates.at(-1).at, at.toISOString());
  assert.equal(updated.requester, "user-a");
});

test("server rejects skipped workflow states, invalid resolution, and unapproved changes", () => {
  const created = applyWorkspaceUpdate(empty(), { ...empty(), tickets: [candidateTicket("INC-2401")] }, actor("user-a"), at);
  const ticket = created.tickets[0] as Record<string, any>;
  assert.throws(() => applyWorkspaceUpdate(created, {
    ...created, tickets: [{ ...ticket, status: "Clos", closedAt: at.toISOString() }],
  }, actor("user-b"), at), /Transition non autorisée/);

  const change = applyWorkspaceUpdate(empty(), { ...empty(), tickets: [candidateTicket("CHG-2401", "Changement")] }, actor("user-a"), at);
  const changeTaken = applyWorkspaceUpdate(change, {
    ...change, tickets: [{ ...(change.tickets[0] as Record<string, any>), status: "Pris en compte" }],
  }, actor("user-b"), at);
  assert.throws(() => applyWorkspaceUpdate(changeTaken, {
    ...changeTaken, tickets: [{ ...(changeTaken.tickets[0] as Record<string, any>), status: "En cours" }],
  }, actor("user-b"), at), /approbation CAB/);
});

test("an unchanged legacy resolved example does not block other workspace saves", () => {
  const legacyResolved = {
    ...candidateTicket("INC-2406"),
    status: "Résolu",
    acknowledgedAt: at.toISOString(),
    resolvedAt: at.toISOString(),
    closedAt: null,
    rootCause: null,
    resolution: null,
  };
  const active = {
    ...candidateTicket("INC-2407"),
    status: "En cours",
    acknowledgedAt: at.toISOString(),
    resolvedAt: null,
    closedAt: null,
  };
  const current = { ...empty(), tickets: [legacyResolved, active] };
  const updated = applyWorkspaceUpdate(current, {
    ...current,
    tickets: [legacyResolved, { ...active, title: "Titre modifié" }],
  }, actor("user-a"), at);

  assert.equal((updated.tickets[0] as Record<string, unknown>).status, "Résolu");
  assert.equal((updated.tickets[0] as Record<string, unknown>).rootCause, null);
  assert.equal((updated.tickets[1] as Record<string, unknown>).title, "Titre modifié");
  assert.throws(() => applyWorkspaceUpdate(current, {
    ...current,
    tickets: [legacyResolved, { ...active, status: "Résolu", resolvedAt: at.toISOString() }],
  }, actor("user-a"), at), /Documentez la cause racine et la solution/);
});

test("server enforces maker-checker CAB, requester confirmation, escalation steps, and KEDB creation", () => {
  const changeCandidate = { ...candidateTicket("CHG-2401", "Changement"), supportLevel: 1 };
  let store = applyWorkspaceUpdate(empty(), {
    ...empty(), tickets: [changeCandidate],
  }, actor("user-a"), at);
  let ticket = store.tickets[0] as Record<string, any>;
  const proposed = (patch: Record<string, unknown>) => ({
    ...store,
    tickets: [{ ...ticket, ...patch }],
  });
  assert.throws(() => applyWorkspaceUpdate(store, proposed({
    cab: { decision: "Approuvé", reason: "", by: "fake", at: "2000-01-01" },
  }), actor("user-a", "N1"), at), /demandeur ne peut pas/);
  store = applyWorkspaceUpdate(store, proposed({
    cab: { decision: "Approuvé", reason: "", by: "fake", at: "2000-01-01" },
  }), actor("user-b", "N1"), at);
  ticket = store.tickets[0] as Record<string, any>;
  assert.equal(ticket.cab.by, "user-b");
  assert.equal(ticket.cab.at, at.toISOString());

  assert.throws(() => applyWorkspaceUpdate(store, proposed({ supportLevel: 3 }), actor("user-b"), at), /un seul niveau/);
  store = applyWorkspaceUpdate(store, proposed({ status: "Pris en compte" }), actor("user-b"), at);
  ticket = store.tickets[0] as Record<string, any>;
  store = applyWorkspaceUpdate(store, proposed({ supportLevel: 2 }), actor("user-b"), at);
  ticket = store.tickets[0] as Record<string, any>;
  store = applyWorkspaceUpdate(store, proposed({ status: "En cours", supportLevel: 3 }), actor("user-b"), at);
  ticket = store.tickets[0] as Record<string, any>;
  store = applyWorkspaceUpdate(store, proposed({
    status: "Résolu",
    rootCause: "Cause de test suffisamment documentée.",
    resolution: "Solution de test suffisamment documentée.",
  }), actor("user-b"), at);
  ticket = store.tickets[0] as Record<string, any>;
  assert.throws(() => applyWorkspaceUpdate(store, proposed({ status: "Clos" }), actor("user-b"), at), /demandeur authentifié/);
  store = applyWorkspaceUpdate(store, proposed({ status: "Clos" }), actor("user-a"), at);
  ticket = store.tickets[0] as Record<string, any>;
  assert.equal(ticket.status, "Clos");
  assert.equal(ticket.closedAt, at.toISOString());
  assert.equal(store.kedb.length, 1);
  assert.equal(store.kedb[0].author, "user-a");
});

test("N2 cannot decide CAB and N5 cannot save workspace changes", () => {
  const createdChange = applyWorkspaceUpdate(empty(), {
    ...empty(), tickets: [candidateTicket("CHG-2401", "Changement")],
  }, actor("requester"), at);
  const change = createdChange.tickets[0] as Record<string, any>;
  assert.throws(() => applyWorkspaceUpdate(createdChange, {
    ...createdChange,
    tickets: [{ ...change, cab: { decision: "Approuvé", reason: "", by: "forged", at: at.toISOString() } }],
  }, actor("analyst", "N2"), at), /action n’est pas autorisée/);

  const auditor = actor("auditor", "N5");
  const auditorView = userStoreView(empty(), auditor);
  assert.throws(() => applyWorkspaceUpdate(empty(), {
    ...auditorView,
    audit: [{ id: "forged", action: "Décision fictive", actor: "forged", scope: "test" }],
  }, auditor, at), /action n’est pas autorisée/);
});

test("N4 receives and updates only tickets within assigned service scope", () => {
  const current = {
    ...empty(),
    services: [{ id: "service-a" }, { id: "service-b" }],
    tickets: [
      { ...candidateTicket("INC-2401"), status: "Nouveau", serviceId: "service-a", requesterId: "requester-a" },
      { ...candidateTicket("INC-2402"), status: "Nouveau", serviceId: "service-b", requesterId: "requester-b" },
    ],
  };
  const n4 = actor("support-a", "N4", ["service-a"]);
  const view = userStoreView(current, n4);
  assert.deepEqual((view.tickets as Record<string, any>[]).map(ticket => ticket.id), ["INC-2401"]);
  assert.deepEqual(view.conversations, []);
  const scopedTicket = (view.tickets as Record<string, any>[])[0];
  const updated = applyWorkspaceUpdate(current, {
    ...view,
    tickets: [{ ...scopedTicket, assignee: "Équipe service A" }],
  }, n4, at);
  assert.equal((updated.tickets as Record<string, any>[]).length, 2);
  assert.equal((updated.tickets as Record<string, any>[]).find(ticket => ticket.id === "INC-2401")?.assignee, "Équipe service A");
  assert.equal((updated.tickets as Record<string, any>[]).find(ticket => ticket.id === "INC-2402")?.assignee, "Équipe support");
  assert.throws(() => applyWorkspaceUpdate(current, {
    ...view,
    tickets: [{ ...scopedTicket, serviceId: "service-b", assignee: "Équipe service B" }],
  }, n4, at), /périmètre de service/);
});

test("N4 version conflicts include only records and details within assigned service scope", () => {
  const current = {
    ...empty(),
    services: [
      { id: "service-a", name: "Service autorisé" },
      { id: "service-b", name: "Service confidentiel" },
    ],
    tickets: [
      { ...candidateTicket("INC-2401"), serviceId: "service-a", assetId: "asset-a" },
      { ...candidateTicket("INC-2402"), serviceId: "service-b", assetId: "asset-b", description: "Détail hors périmètre" },
    ],
    assets: [
      { id: "asset-a", name: "Équipement autorisé" },
      { id: "asset-b", name: "Équipement confidentiel" },
    ],
    kedb: [
      { id: "KEDB-a", serviceId: "service-a", title: "Article autorisé" },
      { id: "KEDB-b", serviceId: "service-b", title: "Article confidentiel" },
    ],
    notifications: [
      { id: "notification-a", ticketId: "INC-2401", message: "Notification autorisée" },
      { id: "notification-b", ticketId: "INC-2402", message: "Notification confidentielle" },
    ],
    conversations: [{ id: "conversation-1", title: "Canal confidentiel" }],
    audit: [{ id: "audit-1", action: "Événement confidentiel" }],
  };
  const n4 = actor("support-a", "N4", ["service-a"]);
  const rejected = saveWorkspaceAtVersion(current, 4, current, 3, n4, at);

  assert.equal(rejected.conflict, true);
  if (!rejected.conflict) assert.fail("The stale N4 save must receive a version conflict.");
  const response = workspaceVersionConflictResponse(rejected.store, rejected.version, n4);

  assert.deepEqual(Object.keys(response.current), ["store", "version"]);
  assert.equal(response.current.version, 4);
  const visible = response.current.store;
  assert.deepEqual((visible.tickets as Record<string, any>[]).map(ticket => ticket.id), ["INC-2401"]);
  assert.deepEqual((visible.services as Record<string, any>[]).map(service => service.id), ["service-a"]);
  assert.deepEqual((visible.assets as Record<string, any>[]).map(asset => asset.id), ["asset-a"]);
  assert.deepEqual((visible.kedb as Record<string, any>[]).map(article => article.id), ["KEDB-a"]);
  assert.deepEqual((visible.notifications as Record<string, any>[]).map(item => item.id), ["notification-a"]);
  assert.deepEqual(visible.conversations, []);
  assert.deepEqual(visible.audit, []);
  assert.ok(!JSON.stringify(response).includes("INC-2402"));
  assert.ok(!JSON.stringify(response).includes("Service confidentiel"));
  assert.ok(!JSON.stringify(response).includes("Équipement confidentiel"));
  assert.ok(!JSON.stringify(response).includes("Article confidentiel"));
  assert.ok(!JSON.stringify(response).includes("Notification confidentielle"));
  assert.ok(!JSON.stringify(response).includes("Détail hors périmètre"));
});

test("N4 version conflicts reveal no records when no service is assigned", () => {
  const current = {
    ...empty(),
    services: [{ id: "service-secret", name: "Service confidentiel" }],
    tickets: [{
      ...candidateTicket("INC-secret"),
      serviceId: "service-secret",
      assetId: "asset-secret",
      title: "Dossier confidentiel",
      description: "Détail confidentiel du dossier",
    }],
    assets: [{ id: "asset-secret", name: "Équipement confidentiel" }],
    kedb: [{ id: "KEDB-secret", serviceId: "service-secret", title: "Article confidentiel" }],
    notifications: [{
      id: "notification-secret",
      ticketId: "INC-secret",
      message: "Notification confidentielle",
    }],
    conversations: [{ id: "conversation-secret", title: "Canal confidentiel" }],
    audit: [{ id: "audit-secret", action: "Événement confidentiel" }],
  };
  const n4 = actor("support-sans-service", "N4", []);
  const rejected = saveWorkspaceAtVersion(current, 7, current, 6, n4, at);

  assert.equal(rejected.conflict, true);
  if (!rejected.conflict) assert.fail("The stale N4 save must receive a version conflict.");
  const response = workspaceVersionConflictResponse(rejected.store, rejected.version, n4);

  assert.equal(response.error, ITSM_WORKSPACE_VERSION_CONFLICT_MESSAGE);
  assert.equal(response.current.version, 7);
  const visible = response.current.store;
  for (const collection of ["tickets", "services", "assets", "kedb", "notifications", "conversations", "audit"]) {
    assert.deepEqual(visible[collection], [], `N4 without services must receive an empty ${collection} collection`);
  }

  const responseText = JSON.stringify(response);
  for (const forbidden of [
    "INC-secret",
    "Dossier confidentiel",
    "Détail confidentiel du dossier",
    "service-secret",
    "Service confidentiel",
    "asset-secret",
    "Équipement confidentiel",
    "KEDB-secret",
    "Article confidentiel",
    "notification-secret",
    "Notification confidentielle",
    "conversation-secret",
    "Canal confidentiel",
    "audit-secret",
    "Événement confidentiel",
  ]) {
    assert.ok(!responseText.includes(forbidden), `The N4 conflict response must not contain ${forbidden}`);
  }
});

test("the real workspace save route returns a scoped 409 for a stale N4 save", {
  skip: !process.env.DATABASE_URL && "Requires the PostgreSQL integration database",
}, async () => {
  const workspaceId = `itsm-n4-conflict-${randomUUID()}`;
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const tempBuildDir = await mkdtemp(path.join(packageDir, "node_modules", ".itsm-n4-conflict-"));
  let pool: import("pg").Pool | undefined;
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;

  try {
    const bundlePath = path.join(tempBuildDir, "itsm-workspace-route.mjs");
    await mkdir(path.join(tempBuildDir, "node_modules"), { recursive: true });
    await symlink(
      path.resolve(packageDir, "../../lib/db/node_modules/pg"),
      path.join(tempBuildDir, "node_modules/pg"),
    );
    await build({
      entryPoints: [path.join(packageDir, "src/routes/itsm.ts")],
      outfile: bundlePath,
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["express", "express-rate-limit", "pkijs", "asn1js", "pino", "pino-http", "@clerk/express", "pg"],
      sourcemap: false,
      logLevel: "silent",
    });
    const { createItsmWorkspaceSaveRouter } = await import(bundlePath);
    const requireFromPackage = createRequire(path.join(packageDir, "src/routes/itsm.ts"));
    const pg = requireFromPackage(path.resolve(packageDir, "../../lib/db/node_modules/pg"));
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    const currentStore = {
      ...empty(),
      services: [
        { id: "service-a", name: "Service autorisé" },
        { id: "service-b", name: "Service confidentiel" },
      ],
      tickets: [
        { ...candidateTicket("INC-allowed"), serviceId: "service-a", assetId: "asset-a", description: "Détail autorisé" },
        { ...candidateTicket("INC-forbidden"), serviceId: "service-b", assetId: "asset-b", description: "Détail hors périmètre" },
      ],
      assets: [
        { id: "asset-a", name: "Équipement autorisé" },
        { id: "asset-b", name: "Équipement confidentiel" },
      ],
      kedb: [
        { id: "KEDB-allowed", serviceId: "service-a", title: "Article autorisé" },
        { id: "KEDB-forbidden", serviceId: "service-b", title: "Article confidentiel" },
      ],
      notifications: [
        { id: "notification-allowed", ticketId: "INC-allowed", message: "Notification autorisée" },
        { id: "notification-forbidden", ticketId: "INC-forbidden", message: "Notification confidentielle" },
      ],
      conversations: [{ id: "conversation-secret", title: "Canal confidentiel" }],
      audit: [{ id: "audit-secret", action: "Événement confidentiel" }],
    };
    await pool.query(
      `INSERT INTO "anif_itsm_workspace" (id, version, store, imported_users)
       VALUES ($1, $2, $3::jsonb, ARRAY[]::text[])`,
      [workspaceId, 4, JSON.stringify(currentStore)],
    );

    const app = express();
    app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
    app.use(express.json());
    app.use(createItsmWorkspaceSaveRouter({
      workspaceId,
      resolveActor: async () => actor("support-a", "N4", ["service-a"]),
    }, (_req, _res, next) => next()));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const response = await fetch(`http://127.0.0.1:${address.port}/itsm`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 3, store: empty() }),
    });
    const body = await response.json() as {
      error?: string;
      current?: { version: number; store: Record<string, unknown> };
    };

    assert.equal(response.status, 409);
    assert.equal(body.current?.version, 4);
    const visible = body.current?.store;
    assert.ok(visible);
    assert.deepEqual((visible.tickets as Record<string, unknown>[]).map((ticket) => ticket.id), ["INC-allowed"]);
    assert.deepEqual((visible.services as Record<string, unknown>[]).map((service) => service.id), ["service-a"]);
    assert.deepEqual((visible.assets as Record<string, unknown>[]).map((asset) => asset.id), ["asset-a"]);
    assert.deepEqual((visible.kedb as Record<string, unknown>[]).map((article) => article.id), ["KEDB-allowed"]);
    assert.deepEqual((visible.notifications as Record<string, unknown>[]).map((item) => item.id), ["notification-allowed"]);
    assert.deepEqual(visible.conversations, []);
    assert.deepEqual(visible.audit, []);

    const responseText = JSON.stringify(body);
    for (const forbidden of [
      "INC-forbidden",
      "Service confidentiel",
      "asset-b",
      "Équipement confidentiel",
      "KEDB-forbidden",
      "Article confidentiel",
      "notification-forbidden",
      "Notification confidentielle",
      "conversation-secret",
      "Canal confidentiel",
      "audit-secret",
      "Événement confidentiel",
      "Détail hors périmètre",
    ]) {
      assert.ok(!responseText.includes(forbidden), `The N4 conflict response must not contain ${forbidden}`);
    }
    const { rows } = await pool.query(
      'SELECT version FROM "anif_itsm_workspace" WHERE id = $1',
      [workspaceId],
    );
    assert.equal(rows[0]?.version, 4, "a stale save must not change the persisted workspace version");
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
      });
    }
    if (pool) {
      await pool.query('DELETE FROM "anif_itsm_workspace" WHERE id = $1', [workspaceId]);
      await pool.end();
    }
    await rm(tempBuildDir, { recursive: true, force: true });
  }
});

test("N5 workspace view hides ticket, conversation, service, and asset details but retains audit and KEDB", () => {
  const store = {
    ...empty(),
    tickets: [{ ...candidateTicket("INC-2401"), serviceId: "service-a" }],
    conversations: [{ id: "conversation-1", title: "Confidentiel fictif", messages: [], readCount: 0 }],
    services: [{ id: "service-a", name: "Service fictif" }],
    assets: [{ id: "asset-1", name: "Équipement fictif" }],
    audit: [{ id: "audit-1", action: "Contrôle fictif", actor: "N3", scope: "Support" }],
    kedb: [{ id: "KEDB-1", ticketId: "INC-2401", title: "Article fictif" }],
  };
  const view = userStoreView(store, actor("auditor", "N5"));
  assert.deepEqual(view.tickets, []);
  assert.deepEqual(view.conversations, []);
  assert.deepEqual(view.services, []);
  assert.deepEqual(view.assets, []);
  assert.equal((view.audit as Record<string, any>[]).length, 1);
  assert.equal((view.kedb as Record<string, any>[]).length, 1);
  assert.ok((view.seeded as string[]).includes("itil-tickets"));
});

test("authenticated ticket conversion is audited once, persists, and appears in CSV export", async (t) => {
  const message = { id: "sup-2", author: "requester", body: "Symptôme fictif à convertir.", time: "" };
  const conversation = {
    id: "conversation-1",
    kind: "Support",
    title: "Canal de support fictif",
    messages: [message],
    readCount: 1,
    participants: ["requester", "support"],
    classification: "Interne",
  };
  const current = { ...empty(), conversations: [conversation] };
  const clientMessage = {
    id: "client-generated",
    author: "forged",
    body: "Un ticket fictif vient d’être créé.",
    time: "",
    system: true,
    ticketId: "INC-client",
  };
  const save = saveWorkspaceAtVersion(current, 0, {
    ...current,
    tickets: [{
      ...candidateTicket("INC-client"),
      status: "Nouveau",
      conversationId: conversation.id,
      sourceMessageId: message.id,
    }],
    conversations: [{
      id: conversation.id,
      title: conversation.title,
      kind: conversation.kind,
      classification: conversation.classification,
      participants: conversation.participants,
      readCount: conversation.readCount,
      messages: [message, clientMessage],
    }],
  }, 0, actor("user-a"), at);
  if (save.conflict) assert.fail("The conversion save should not conflict.");
  const result = save.store;

  assert.equal(save.version, 1);
  assert.equal(result.tickets[0].conversationId, conversation.id);
  assert.equal(result.tickets[0].sourceMessageId, message.id);
  assert.deepEqual(result.conversations[0].messages[0], message);
  // The browser's notice is dropped; the server writes its own, under its own author.
  assert.equal(result.conversations[0].messages.length, 2);
  assert.equal(result.conversations[0].messages[1].author, `Suivi ${result.tickets[0].id}`);
  assert.equal(result.conversations[0].messages[1].system, true);
  assert.equal(result.conversations[0].messages[1].ticketId, result.tickets[0].id);
  assert.notEqual(result.conversations[0].messages[1].id, clientMessage.id);
  assert.notEqual(result.conversations[0].messages[1].body, clientMessage.body);
  assert.equal(result.conversations[0].messages[1].at, at.toISOString());
  assert.equal(result.audit.length, 1);
  assert.equal(result.audit[0].type, ITSM_TICKET_CONVERSION_AUDIT_TYPE);
  assert.equal(result.audit[0].actor, "user-a");
  assert.equal(result.audit[0].ticketId, result.tickets[0].id);
  assert.equal(result.audit[0].sourceMessageId, message.id);

  // Reload from the returned server snapshot and verify the same single entry
  // is available to the authenticated audit export.
  const reloaded = JSON.parse(JSON.stringify(result));
  assert.equal(reloaded.audit.filter((event: Record<string, unknown>) =>
    event.type === ITSM_TICKET_CONVERSION_AUDIT_TYPE).length, 1);
  const app = express();
  app.get("/audit/export", createItsmAuditExportHandler({
    resolveActor: async () => actor("user-a"),
    loadAuditEvents: async () => reloaded.audit,
  }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const response = await fetch(`http://127.0.0.1:${address.port}/audit/export`);
  const csv = await response.text();
  assert.equal(response.status, 200);
  assert.match(csv, /INC-2401/);
  assert.match(csv, /sup-2/);
  assert.match(csv, /user-a/);
  assert.equal((csv.match(/itsm\.ticket\.converted/g) ?? []).length, 0);
  assert.equal((csv.match(/Message sup-2 du canal support converti en incident INC-2401/g) ?? []).length, 1);

  const replay = saveWorkspaceAtVersion(result, 1, result, 1, actor("user-a"), at);
  if (replay.conflict) assert.fail("The unchanged conversion save should not conflict.");
  assert.equal(replay.store.audit.filter((event: Record<string, unknown>) =>
    event.type === ITSM_TICKET_CONVERSION_AUDIT_TYPE).length, 1);

  assert.throws(() => applyWorkspaceUpdate(current, {
    ...current,
    conversations: [{ ...conversation, title: "Titre modifié" }],
  }, actor("user-a"), at), /informations d’une conversation existante/);
  assert.throws(() => applyWorkspaceUpdate(current, {
    ...current,
    conversations: [{
      ...conversation,
      messages: [{ ...message, body: "Historique falsifié." }],
    }],
  }, actor("user-a"), at), /historique de messagerie ne peut pas être réécrit/);
});

test("concurrent authorized conversions of one Support message accept one save and return the winning state", {
  skip: !process.env.DATABASE_URL && "Requires the PostgreSQL integration database",
}, async () => {
  const workspaceId = `itsm-conversion-race-${randomUUID()}`;
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const tempBuildDir = await mkdtemp(path.join(packageDir, "node_modules", ".itsm-conversion-race-"));
  let pool: import("pg").Pool | undefined;
  let server: ReturnType<ReturnType<typeof express>["listen"]> | undefined;

  try {
    const bundlePath = path.join(tempBuildDir, "itsm-workspace-route.mjs");
    await mkdir(path.join(tempBuildDir, "node_modules"), { recursive: true });
    await symlink(
      path.resolve(packageDir, "../../lib/db/node_modules/pg"),
      path.join(tempBuildDir, "node_modules/pg"),
    );
    await build({
      entryPoints: [path.join(packageDir, "src/routes/itsm.ts")],
      outfile: bundlePath,
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["express", "express-rate-limit", "pkijs", "asn1js", "pino", "pino-http", "@clerk/express", "pg"],
      sourcemap: false,
      logLevel: "silent",
    });
    const { createItsmWorkspaceSaveRouter } = await import(bundlePath);
    const requireFromPackage = createRequire(path.join(packageDir, "src/routes/itsm.ts"));
    const pg = requireFromPackage(path.resolve(packageDir, "../../lib/db/node_modules/pg"));
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    const message = {
      id: "support-race-message",
      author: "Demandeur fictif",
      body: "Symptôme fictif converti simultanément.",
      time: "",
      at: at.toISOString(),
    };
    const currentStore = {
      ...empty(),
      conversations: [{
        id: "support-race-conversation",
        kind: "Support",
        title: "Canal support isolé",
        messages: [message],
        readCount: 1,
        participants: ["Demandeur fictif", "Support"],
        classification: "Interne",
      }],
    };
    await pool.query(
      `INSERT INTO "anif_itsm_workspace" (id, version, store, imported_users)
       VALUES ($1, 0, $2::jsonb, ARRAY[]::text[])`,
      [workspaceId, JSON.stringify(currentStore)],
    );

    const app = express();
    app.use(pinoHttp({ logger: pino({ level: "silent" }) }));
    app.use(express.json());
    app.use(createItsmWorkspaceSaveRouter({
      workspaceId,
      resolveActor: async (req) => actor(req.header("x-test-actor") ?? "missing-actor", "N1"),
    }, (_req, _res, next) => next()));
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const submitConversion = (accountId: string) => fetch(`http://127.0.0.1:${address.port}/itsm`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-test-actor": accountId,
      },
      body: JSON.stringify({
        version: 0,
        store: {
          ...currentStore,
          tickets: [{
            ...candidateTicket(`client-${accountId}`),
            status: "Nouveau",
            conversationId: "support-race-conversation",
            sourceMessageId: message.id,
          }],
        },
      }),
    });
    const responses = await Promise.all([
      submitConversion("authorized-a"),
      submitConversion("authorized-b"),
    ]);
    const results = await Promise.all(responses.map(async (response) => ({
      status: response.status,
      body: await response.json() as {
        store?: Record<string, any>;
        version?: number;
        current?: { store: Record<string, any>; version: number };
      },
    })));

    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    const accepted = results.find((result) => result.status === 200)!;
    const rejected = results.find((result) => result.status === 409)!;
    assert.equal(accepted.body.version, 1);
    assert.equal(accepted.body.store?.tickets.filter(
      (ticket: Record<string, unknown>) => ticket.sourceMessageId === message.id,
    ).length, 1);
    assert.equal(accepted.body.store?.audit.filter(
      (event: Record<string, unknown>) =>
        event.type === ITSM_TICKET_CONVERSION_AUDIT_TYPE && event.sourceMessageId === message.id,
    ).length, 1);
    const winningTicket = accepted.body.store?.tickets.find(
      (ticket: Record<string, unknown>) => ticket.sourceMessageId === message.id,
    );
    const winningAuditEvent = accepted.body.store?.audit.find(
      (event: Record<string, unknown>) =>
        event.type === ITSM_TICKET_CONVERSION_AUDIT_TYPE && event.sourceMessageId === message.id,
    );
    assert.ok(winningTicket);
    assert.ok(winningAuditEvent);
    assert.ok(["authorized-a", "authorized-b"].includes(winningAuditEvent.actor));
    assert.equal(winningAuditEvent.actor, winningTicket.requester);
    assert.equal(rejected.body.current?.version, 1);
    assert.equal(rejected.body.current?.store.tickets.filter(
      (ticket: Record<string, unknown>) => ticket.sourceMessageId === message.id,
    ).length, 1);
    assert.equal(rejected.body.current?.store.audit.filter(
      (event: Record<string, unknown>) =>
        event.type === ITSM_TICKET_CONVERSION_AUDIT_TYPE && event.sourceMessageId === message.id,
    ).length, 1);

    const { rows } = await pool.query(
      'SELECT version, store FROM "anif_itsm_workspace" WHERE id = $1',
      [workspaceId],
    );
    assert.equal(rows[0]?.version, 1);
    const persisted = rows[0]?.store as Record<string, any>;
    assert.equal(persisted.tickets.filter(
      (ticket: Record<string, unknown>) => ticket.sourceMessageId === message.id,
    ).length, 1);
    assert.equal(persisted.audit.filter(
      (event: Record<string, unknown>) =>
        event.type === ITSM_TICKET_CONVERSION_AUDIT_TYPE && event.sourceMessageId === message.id,
    ).length, 1);
    assert.deepEqual(
      persisted.conversations[0].messages[0],
      message,
      "both attempts must leave the original Support message unchanged",
    );
    assert.deepEqual(
      persisted.conversations[0].messages.slice(1).map((item: Record<string, unknown>) => [item.system, item.ticketId]),
      [[true, persisted.tickets.find((ticket: Record<string, unknown>) => ticket.sourceMessageId === message.id)!.id]],
      "only the winning conversion is announced, once, by the server",
    );
  } finally {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => error ? reject(error) : resolve());
      });
    }
    if (pool) {
      await pool.query('DELETE FROM "anif_itsm_workspace" WHERE id = $1', [workspaceId]);
      await pool.end();
    }
    await rm(tempBuildDir, { recursive: true, force: true });
  }
});

test("each browser conversion run starts with a fresh isolated Support message", () => {
  const sharedPilotData = {
    ...empty(),
    tickets: [{ ...candidateTicket("INC-shared"), title: "Donnée partagée hors test" }],
    conversations: [{
      id: "shared-support",
      kind: "Support",
      title: "Canal support partagé",
      messages: [{ id: "shared-message", author: "Demandeur", body: "Message partagé intact." }],
    }],
  };
  const untouchedSharedPilotData = structuredClone(sharedPilotData);

  for (const run of [1, 2]) {
    const fixture = conversionBrowserFixture();
    const originalMessage = structuredClone(fixture.conversations[0].messages[0]);
    assert.deepEqual(fixture.tickets, [], `Run ${run} must not inherit incidents from a previous run.`);
    assert.deepEqual(fixture.conversations[0].messages, [originalMessage]);

    const proposedTicket = {
      ...candidateTicket(`INC-e2e-${run}`),
      status: "Nouveau",
      conversationId: fixture.conversations[0].id,
      sourceMessageId: originalMessage.id,
    };
    const saved = saveWorkspaceAtVersion(
      fixture,
      0,
      { ...fixture, tickets: [proposedTicket] },
      0,
      actor(`browser-run-${run}`, "N1"),
      at,
    );
    if (saved.conflict) assert.fail(`Run ${run} must save against its isolated fixture.`);

    assert.equal(saved.store.tickets.length, 1);
    assert.equal(saved.store.tickets[0].sourceMessageId, originalMessage.id);
    assert.deepEqual(saved.store.conversations[0].messages[0], originalMessage);
    assert.equal(
      saved.store.audit.filter((event) => event.type === ITSM_TICKET_CONVERSION_AUDIT_TYPE).length,
      1,
    );
    assert.deepEqual(
      conversionBrowserFixture().conversations[0].messages,
      [originalMessage],
      "A new run must recreate the same unconsumed source message.",
    );
    assert.deepEqual(conversionBrowserFixture().tickets, []);
  }

  assert.deepEqual(sharedPilotData, untouchedSharedPilotData, "The isolated browser fixture must not touch shared pilot data.");
});

test("conversation read progress is private to each authenticated account", () => {
  const conversation = {
    id: "conversation-1", title: "Canal fictif", kind: "Équipe",
    classification: "Interne", participants: ["user-a", "user-b"],
    readCount: 0, messages: [{ id: "message-1", author: "user-a", body: "Message de test." }],
  };
  let store = applyWorkspaceUpdate(empty(), {
    ...empty(), conversations: [conversation],
  }, actor("user-a"), at);
  const actorA = userStoreView(store, actor("user-a"));
  const actorB = userStoreView(store, actor("user-b"));
  store = applyWorkspaceUpdate(store, {
    ...store, conversations: [{ ...store.conversations[0], readCount: 1 }],
  }, actor("user-a"), at);
  assert.equal((userStoreView(store, actor("user-a")).conversations[0] as Record<string, any>).readCount, 1);
  assert.equal((userStoreView(store, actor("user-b")).conversations[0] as Record<string, any>).readCount, 0);
  assert.equal((actorA.conversations[0] as Record<string, any>).readCount, 0);
  assert.equal((actorB.conversations[0] as Record<string, any>).readCount, 0);
});

test("local import preserves existing shared records and keeps conflicting examples separately", () => {
  const shared = {
    ...empty(),
    tickets: [{ ...candidateTicket("INC-2401"), title: "Déjà partagé", status: "Nouveau" }],
  };
  const imported = {
    ...empty(),
    tickets: [{ ...candidateTicket("INC-2401"), title: "Exemple local modifié", status: "Nouveau" }],
  };
  const merged = mergeLocalExamples(shared, imported, actor("user-b"), at);
  assert.equal((merged.tickets.find((ticket) => ticket.id === "INC-2401") as Record<string, unknown>).title, "Déjà partagé");
  assert.equal(merged.tickets.length, 2);
  assert.ok(merged.tickets.some((ticket) => String(ticket.id).includes("-IMP-userb")
    && ticket.title === "Exemple local modifié"));
});

test("ticket deletion is refused even when another item is added in the same save", () => {
  const created = applyWorkspaceUpdate(empty(), { ...empty(), tickets: [candidateTicket("INC-2401")] }, actor("user-a"), at);
  const second = { ...candidateTicket("REQ-2402"), status: "Nouveau" };
  assert.throws(() => applyWorkspaceUpdate(created, { ...created, tickets: [second] }, actor("user-b"), at), /suppression de tickets/);
});

test("simultaneous workspace saves accept one writer and return the latest state to the stale writer", async () => {
  let committed = { store: empty(), version: 0 };
  let transaction = Promise.resolve();
  const commit = (submitted: Record<string, unknown>, writer: WorkspaceActor) => {
    const result = transaction.then(() => {
      const outcome = saveWorkspaceAtVersion(
        committed.store,
        committed.version,
        submitted,
        0,
        writer,
        at,
      );
      if (!outcome.conflict) committed = { store: outcome.store, version: outcome.version };
      return outcome;
    });
    transaction = result.then(() => undefined);
    return result;
  };
  const firstDraft = { ...empty(), tickets: [candidateTicket("draft-a")] };
  const secondDraft = { ...empty(), tickets: [candidateTicket("draft-b")] };

  const outcomes = await Promise.all([
    commit(firstDraft, actor("writer-a")),
    commit(secondDraft, actor("writer-b")),
  ]);
  const accepted = outcomes.filter((outcome) => !outcome.conflict);
  const rejected = outcomes.filter((outcome) => outcome.conflict);

  assert.equal(accepted.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(committed.version, 1);
  const winningId = (committed.store.tickets[0] as Record<string, unknown>).id;
  assert.equal((rejected[0] as Extract<typeof rejected[number], { conflict: true }>).version, 1);
  assert.deepEqual(
    ((rejected[0] as Extract<typeof rejected[number], { conflict: true }>).store.tickets as Record<string, unknown>[])
      .map((ticket) => ticket.id),
    [winningId],
  );
  assert.equal(committed.store.tickets.length, 1, "the stale full snapshot must not overwrite the winning save");
});

test("two accounts see a version conflict, resume independent changes, and retain same-field drafts", () => {
  const startingTicket = {
    ...candidateTicket("INC-2401"),
    title: "Sujet initial",
    status: "Nouveau",
    acknowledgedAt: null,
    resolvedAt: null,
    closedAt: null,
  };
  const baseStore = { ...empty(), tickets: [startingTicket] };
  const firstAccount = actor("account-a");
  const secondAccount = actor("account-b");
  const clientBase = userStoreView(baseStore, secondAccount);

  const runScenario = (localTicket: Record<string, unknown>) => {
    let committed = { store: baseStore, version: 0 };
    const request = (submitted: Record<string, unknown>, expectedVersion: number, writer: WorkspaceActor) => {
      const result = saveWorkspaceAtVersion(
        committed.store,
        committed.version,
        submitted,
        expectedVersion,
        writer,
        at,
      );
      if (result.conflict) {
        return {
          status: 409,
          ...workspaceVersionConflictResponse(result.store, result.version, writer),
        };
      }
      committed = { store: result.store, version: result.version };
      return {
        status: 200,
        store: userStoreView(result.store, writer),
        version: result.version,
      };
    };

    const firstDraft = {
      ...clientBase,
      tickets: [{ ...startingTicket, title: "Sujet du premier compte" }],
    };
    const firstSave = request(firstDraft, 0, firstAccount);
    assert.equal(firstSave.status, 200);
    const secondDraft = { ...clientBase, tickets: [localTicket] };
    const refused = request(secondDraft, 0, secondAccount);
    assert.equal(refused.status, 409);
    if (refused.status !== 409) assert.fail("The stale second account must receive a version conflict.");
    assert.equal(refused.error, ITSM_WORKSPACE_VERSION_CONFLICT_MESSAGE);
    assert.equal(serverRefusalReason({ status: 409, data: refused }), ITSM_WORKSPACE_VERSION_CONFLICT_MESSAGE);
    assert.equal(refused.current.version, 1);
    return { committed, refused, secondDraft };
  };

  const independent = runScenario({
    ...startingTicket,
    status: "Pris en compte",
  });
  const independentMerge = mergeSharedChanges(
    clientBase,
    independent.secondDraft,
    independent.refused.current.store,
  );
  assert.deepEqual(independentMerge.conflicts, []);
  assert.equal((independentMerge.value?.tickets as Record<string, unknown>[])[0].title, "Sujet du premier compte");
  assert.equal((independentMerge.value?.tickets as Record<string, unknown>[])[0].status, "Pris en compte");

  const resumed = saveWorkspaceAtVersion(
    independent.committed.store,
    independent.committed.version,
    independentMerge.value!,
    independent.refused.current.version,
    secondAccount,
    at,
  );
  assert.equal(resumed.conflict, false);
  if (resumed.conflict) assert.fail("Independent changes should be accepted after a controlled merge.");
  assert.equal(resumed.version, 2);
  assert.equal((resumed.store.tickets as Record<string, unknown>[])[0].title, "Sujet du premier compte");
  assert.equal((resumed.store.tickets as Record<string, unknown>[])[0].status, "Pris en compte");

  const sameField = runScenario({
    ...startingTicket,
    title: "Sujet modifié localement",
  });
  const sameFieldMerge = mergeSharedChanges(
    clientBase,
    sameField.secondDraft,
    sameField.refused.current.store,
  );
  assert.deepEqual(sameFieldMerge.conflicts, ["tickets.INC-2401.title"]);
  assert.equal(
    (sameField.refused.current.store.tickets as Record<string, unknown>[])[0].title,
    "Sujet du premier compte",
    "the rejected local title must not replace the remote value",
  );
  assert.deepEqual(changedPaths(clientBase, sameField.secondDraft), ["tickets.INC-2401.title"]);
  assert.deepEqual(
    recoveryEditDetails(sameField.secondDraft, sameFieldMerge.conflicts),
    [{ path: "tickets.INC-2401.title", value: '"Sujet modifié localement"' }],
    "the rejected value must remain readable in the recovery panel",
  );
});
