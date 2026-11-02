import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(result.conversations[0].messages.length, 2);
  assert.equal(result.conversations[0].messages[1].author, "user-a");
  assert.notEqual(result.conversations[0].messages[1].id, clientMessage.id);
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
