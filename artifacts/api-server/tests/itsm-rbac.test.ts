import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { clerkMiddleware } from "@clerk/express";
import { build } from "esbuild";
import {
  canChangeItsmRole,
  canPerform,
  isBootstrapAdmin,
  isItsmRole,
  metadataForItsmBootstrap,
  metadataForItsmRoleChange,
} from "../src/lib/itsm-rbac.ts";
import { createItsmAuditExportHandler } from "../src/routes/itsm-audit-export.ts";
import {
  recordItsmRoleAttestation,
  createItsmRoleReconciliationMonitor,
  findItsmRoleReconciliationIssues,
} from "../src/lib/itsm-workspace.ts";
import { importWithTestDatabaseUrl } from "./helpers/database-bootstrap.ts";

const actor = (role: "N1" | "N2" | "N3" | "N4" | "N5", serviceIds: string[] = []) => ({
  id: `account-${role}`,
  role,
  serviceIds,
});

test("periodic role reconciliation reports Clerk role differences and missing journal traces", () => {
  const findings = findItsmRoleReconciliationIssues([
    { id: "role-drift", role: "N2", serviceIds: ["service-a"] },
    { id: "no-trace", role: "N3", serviceIds: [] },
    { id: "consistent", role: "N4", serviceIds: ["service-b"] },
  ], [
    {
      type: "itsm.role.changed",
      targetUserId: "role-drift",
      nextRole: "N5",
      serviceIds: ["service-a"],
      at: "2026-10-30T11:00:00.000Z",
    },
    {
      type: "itsm.role.changed",
      targetUserId: "consistent",
      nextRole: "N4",
      serviceIds: ["service-b"],
      at: "2026-10-30T10:00:00.000Z",
    },
  ]);

  assert.deepEqual(findings, [
    {
      userId: "role-drift",
      reason: "role_mismatch",
      clerkRole: "N2",
      clerkServiceIds: ["service-a"],
      auditRole: "N5",
      auditServiceIds: ["service-a"],
    },
    {
      userId: "no-trace",
      reason: "missing_audit",
      clerkRole: "N3",
      clerkServiceIds: [],
      auditRole: null,
      auditServiceIds: [],
    },
  ]);
});

test("a current-role attestation resolves missing audit without imitating a role change", () => {
  const currentRole = { id: "account-to-attest", role: "N1", serviceIds: [] };
  const initialFindings = findItsmRoleReconciliationIssues([currentRole], []);
  assert.equal(initialFindings[0]?.reason, "missing_audit");

  const nextStore = recordItsmRoleAttestation({ audit: [] }, {
    actorId: "admin-n1",
    targetUserId: currentRole.id,
    role: currentRole.role,
    serviceIds: currentRole.serviceIds,
    scope: "N1 · tous les services",
  }, new Date("2026-11-02T12:00:00.000Z"));
  const attestation = (nextStore.audit as Array<Record<string, unknown>>)[0];

  assert.equal(attestation.type, "itsm.role.attested");
  assert.equal(attestation.action, "Rôle ITSM vérifié (attestation)");
  assert.equal(attestation.actor, "admin-n1");
  assert.equal(attestation.previousRole, "N1");
  assert.equal(attestation.nextRole, "N1");
  assert.deepEqual(findItsmRoleReconciliationIssues(
    [currentRole],
    nextStore.audit,
  ), []);
});

test("periodic role reconciliation compares scopes with the newest role trace", () => {
  const findings = findItsmRoleReconciliationIssues([
    { id: "scope-drift", role: "N4", serviceIds: ["service-b", "service-a", "service-a"] },
  ], [
    {
      type: "itsm.role.changed",
      targetUserId: "scope-drift",
      nextRole: "N4",
      serviceIds: ["service-a"],
      at: "2026-10-30T09:00:00.000Z",
    },
    {
      type: "itsm.role.changed",
      targetUserId: "scope-drift",
      nextRole: "N4",
      serviceIds: ["service-b"],
      at: "2026-10-30T11:00:00.000Z",
    },
  ]);

  assert.deepEqual(findings, [{
    userId: "scope-drift",
    reason: "scope_mismatch",
    clerkRole: "N4",
    clerkServiceIds: ["service-a", "service-b"],
    auditRole: "N4",
    auditServiceIds: ["service-b"],
  }]);
});

test("periodic role reconciliation alerts once per mismatch and reports recovery", async () => {
  const errors: Array<{ fields: Record<string, unknown>; message: string }> = [];
  const infos: Array<{ fields: Record<string, unknown>; message: string }> = [];
  let findings = [{
    userId: "role-drift",
    reason: "role_mismatch" as const,
    clerkRole: "N2",
    clerkServiceIds: ["service-a"],
    auditRole: "N5",
    auditServiceIds: ["service-a"],
  }];
  const monitor = createItsmRoleReconciliationMonitor({
    scan: async () => findings,
    logger: {
      error: (fields, message) => errors.push({ fields, message }),
      info: (fields, message) => infos.push({ fields, message }),
    },
  });

  await monitor.checkNow();
  await monitor.checkNow();
  findings = [];
  await monitor.checkNow();

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.fields.alert, "itsm_role_reconciliation_mismatch");
  assert.equal(infos.length, 1);
  assert.equal(infos[0]?.fields.alert, "itsm_role_reconciliation_recovered");
});

test("all assigned roles can consult, while an unrecognized role is not an assignment", () => {
  for (const role of ["N1", "N2", "N3", "N4", "N5"] as const) {
    assert.equal(canPerform(actor(role), "viewWorkspace"), true);
  }
  assert.equal(isItsmRole("N5"), true);
  assert.equal(isItsmRole("administrator"), false);
  assert.equal(isItsmRole(undefined), false);
});

test("CAB decisions require N1 or a scoped N3 account; resolution is N3-only", () => {
  assert.equal(canPerform(actor("N1"), "approveCab"), true);
  assert.equal(canPerform(actor("N2"), "approveCab"), false);
  assert.equal(canPerform(actor("N3", ["service-a"]), "approveCab", "service-a"), true);
  assert.equal(canPerform(actor("N3", ["service-a"]), "approveCab", "service-b"), false);
  assert.equal(canPerform(actor("N4", ["service-a"]), "approveCab", "service-a"), false);

  assert.equal(canPerform(actor("N3"), "resolveTicket"), true);
  for (const role of ["N1", "N2", "N4", "N5"] as const) {
    assert.equal(canPerform(actor(role), "resolveTicket"), false);
  }
});

test("journal export is limited to N1, N3, and N5", () => {
  for (const role of ["N1", "N3", "N5"] as const) {
    assert.equal(canPerform(actor(role), "exportAudit"), true);
  }
  for (const role of ["N2", "N4"] as const) {
    assert.equal(canPerform(actor(role), "exportAudit"), false);
  }
});

test("audit export sends filtered CSV to authorized roles and no journal data to unauthorized roles", async (t) => {
  const app = express();
  let currentActor = actor("N1");
  let loadCount = 0;
  app.get("/audit/export", createItsmAuditExportHandler({
    resolveActor: async () => currentActor,
    loadAuditEvents: async () => {
      loadCount += 1;
      return [
        {
          id: "event-allowed",
          action: "Connexion",
          actor: "alpha",
          scope: "Pilote",
          time: "13:00",
          at: "2026-10-30T10:00:00.000Z",
        },
        {
          id: "event-filtered",
          action: "Révocation",
          actor: "private-journal-entry",
          scope: "Administration",
          time: "14:00",
          at: "2026-10-30T11:00:00.000Z",
        },
        {
          id: "event-legacy",
          action: "Trace historique",
          actor: "ancien-agent",
          scope: "Pilote",
          time: "09:17",
        },
      ];
    },
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
  const url = `http://127.0.0.1:${address.port}/audit/export?q=alpha`;

  const authorizedResponse = await fetch(url);
  const csv = await authorizedResponse.text();
  assert.equal(authorizedResponse.status, 200);
  assert.match(authorizedResponse.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(csv, /event-allowed/);
  assert.doesNotMatch(csv, /event-filtered|private-journal-entry/);
  assert.equal(loadCount, 1);

  const timeOnlyResponse = await fetch(`http://127.0.0.1:${address.port}/audit/export?q=13%3A00`);
  const timeOnlyCsv = await timeOnlyResponse.text();
  assert.equal(timeOnlyResponse.status, 200);
  assert.match(timeOnlyCsv, /event-allowed/);
  assert.doesNotMatch(timeOnlyCsv, /event-filtered|private-journal-entry/);
  assert.equal(loadCount, 2);

  const historicalResponse = await fetch(`http://127.0.0.1:${address.port}/audit/export?q=09%3A17`);
  const historicalCsv = await historicalResponse.text();
  assert.equal(historicalResponse.status, 200);
  const historicalRows = historicalCsv.split("\r\n").filter(Boolean);
  assert.equal(historicalRows.length, 2, "the hour search should export only the historical event");
  assert.equal(
    historicalRows[1],
    '"event-legacy";"Trace historique";"ancien-agent";"";"";"";"";"";"";"";"Pilote";"";"09:17";"";"";""',
  );
  assert.equal(loadCount, 3);

  for (const invalidDateQuery of ["from=2026-02-30", "to=2026-13-01"]) {
    const invalidDateResponse = await fetch(
      `http://127.0.0.1:${address.port}/audit/export?${invalidDateQuery}`,
    );
    const refusal = await invalidDateResponse.text();
    assert.equal(invalidDateResponse.status, 400);
    assert.doesNotMatch(invalidDateResponse.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(refusal, /date .* invalide/i);
    assert.doesNotMatch(refusal, /event-allowed|event-filtered|private-journal-entry/);
    assert.equal(loadCount, 3, "invalid dates must be rejected before journal events are loaded");
  }

  currentActor = actor("N2");
  const unauthorizedResponse = await fetch(url);
  const refusal = await unauthorizedResponse.text();
  assert.equal(unauthorizedResponse.status, 403);
  assert.doesNotMatch(unauthorizedResponse.headers.get("content-type") ?? "", /text\/csv/);
  assert.doesNotMatch(refusal, /event-allowed|event-filtered|private-journal-entry/);
  assert.equal(loadCount, 3, "the journal must not be loaded for a role without export permission");
});

test("the mounted audit export route rejects requests without a Clerk session", async (t) => {
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const tempBuildDir = await mkdtemp(path.join(packageDir, "node_modules", ".itsm-audit-auth-test-"));
  const tempNodeModules = path.join(tempBuildDir, "node_modules");
  await mkdir(tempNodeModules, { recursive: true });
  await symlink(
    path.resolve(packageDir, "../../lib/db/node_modules/pg"),
    path.join(tempNodeModules, "pg"),
  );

  try {
    const bundlePath = path.join(tempBuildDir, "itsm-route.mjs");
    await build({
      entryPoints: [path.join(packageDir, "src/routes/itsm.ts")],
      outfile: bundlePath,
      bundle: true,
      platform: "node",
      format: "esm",
      external: ["@clerk/express", "express", "express-rate-limit", "pkijs", "asn1js", "pino", "pino-http", "pg"],
      sourcemap: false,
      logLevel: "silent",
    });
    const { default: itsmRouter } = await importWithTestDatabaseUrl(() => import(pathToFileURL(bundlePath).href));
    const app = express();
    app.use(clerkMiddleware({
      publishableKey: "pk_test_Y2xlcmsuZGV2JA",
      secretKey: "sk_test_c2VjcmV0",
    }));
    app.use("/api", itsmRouter);

    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      const address = server.address();
      assert.ok(address && typeof address !== "string");

      const response = await fetch(`http://127.0.0.1:${address.port}/api/itsm/audit/export`);
      const body = await response.text();

      assert.equal(response.status, 401);
      assert.doesNotMatch(response.headers.get("content-type") ?? "", /text\/csv/i);
      assert.doesNotMatch(body, /text\/csv|Identifiant|event-|private-journal-entry/i);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  } finally {
    await rm(tempBuildDir, { recursive: true, force: true });
  }
});

test("audit export matches accent-insensitive, case-insensitive client journal searches", async (t) => {
  const app = express();
  app.get("/audit/export", createItsmAuditExportHandler({
    resolveActor: async () => actor("N1"),
    loadAuditEvents: async () => [
      {
        id: "event-accented",
        action: "Habilitation modifiée",
        actor: "Élodie",
        scope: "Messagerie",
        time: "13:00",
        at: "2026-10-30T10:00:00.000Z",
      },
      {
        id: "event-unaccented",
        action: "Habilitation modifiee",
        actor: "Elodie",
        scope: "Messagerie",
        time: "13:01",
        at: "2026-10-30T10:01:00.000Z",
      },
      {
        id: "event-other",
        action: "Habilitation supprimée",
        actor: "Élodie",
        scope: "Messagerie",
        time: "13:02",
        at: "2026-10-30T10:02:00.000Z",
      },
    ],
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

  const csvResults = await Promise.all(
    ["MODIFIEE", "modifiée", "  modifi\u0065\u0301e  "].map(async (query) => {
      const params = new URLSearchParams({ q: query });
      const response = await fetch(`http://127.0.0.1:${address.port}/audit/export?${params}`);
      assert.equal(response.status, 200);
      return response.text();
    }),
  );

  for (const csv of csvResults) {
    const exportedIds = csv.split("\r\n").filter(Boolean).slice(1).map((row) => row.split(";")[0]);
    assert.deepEqual(exportedIds, ['"event-accented"', '"event-unaccented"']);
    assert.doesNotMatch(csv, /event-other|Habilitation supprimée/u);
  }
  assert.equal(csvResults[0], csvResults[1]);
  assert.equal(csvResults[1], csvResults[2]);
});

test("audit export adds account names, searches them and survives a directory outage", async (t) => {
  const events = [
    { id: "event-role", action: "Rôle attribué", actor: "user_alphaAAAA", targetUserId: "user_bravoBBBB", scope: "Administration", at: "2026-10-30T10:00:00.000Z" },
    { id: "event-formula", action: "Connexion", actor: "user_formulaFF", scope: "Pilote", at: "2026-10-30T10:30:00.000Z" },
    { id: "event-legacy", action: "Connexion", actor: "Olivier Nguema", scope: "Pilote", at: "2026-10-30T11:00:00.000Z" },
  ];
  let directoryDown = false;
  let requestedIds: string[] = [];
  const app = express();
  app.get("/audit/export", createItsmAuditExportHandler({
    resolveActor: async () => actor("N1"),
    loadAuditEvents: async () => events,
    resolveNames: async (ids) => {
      requestedIds = ids;
      if (directoryDown) throw new Error("Clerk unavailable");
      return new Map([["user_alphaAAAA", "Awa Mba"], ["user_bravoBBBB", "Paul Nziengui"], ["user_formulaFF", "=HYPERLINK(\"x\")"]]);
    },
  }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/audit/export`;

  const csv = await (await fetch(base)).text();
  const [header, roleRow] = csv.replace(/^\uFEFF/u, "").split("\r\n");
  assert.match(header, /"Acteur";"Nom de l’acteur";"Compte cible";"Nom du compte cible"/);
  assert.match(roleRow, /"user_alphaAAAA";"Awa Mba";"user_bravoBBBB";"Paul Nziengui"/);
  assert.deepEqual(requestedIds.sort(), ["user_alphaAAAA", "user_bravoBBBB", "user_formulaFF"], "only Clerk IDs are looked up");
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/, "a name cannot inject a spreadsheet formula");

  const byName = await (await fetch(`${base}?q=nziengui`)).text();
  assert.match(byName, /event-role/);
  assert.doesNotMatch(byName, /event-legacy/);

  directoryDown = true;
  const degraded = await fetch(base);
  assert.equal(degraded.status, 200);
  assert.match(await degraded.text(), /"user_alphaAAAA";"";"user_bravoBBBB";""/);
});

test("only N1 can assign ITSM roles", () => {
  assert.equal(canPerform(actor("N1"), "assignRole"), true);
  for (const role of ["N2", "N3", "N4", "N5"] as const) {
    assert.equal(canPerform(actor(role), "assignRole"), false);
  }
});

test("role assignment failures preserve audit consistency or raise a reconciliation alert", async (t) => {
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const tempBuildDir = await mkdtemp(path.join(packageDir, "node_modules", ".itsm-role-failure-test-"));
  const tempNodeModules = path.join(tempBuildDir, "node_modules");
  await mkdir(tempNodeModules, { recursive: true });
  await symlink(
    path.resolve(packageDir, "../../lib/db/node_modules/pg"),
    path.join(tempNodeModules, "pg"),
  );
  const bundlePath = path.join(tempBuildDir, "itsm-role-route.mjs");
  await build({
    entryPoints: [path.join(packageDir, "src/routes/itsm.ts")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["@clerk/express", "express", "express-rate-limit", "pkijs", "asn1js", "pino", "pino-http", "pg"],
    sourcemap: false,
    logLevel: "silent",
  });
  const { createItsmRoleAssignmentRouter } = await importWithTestDatabaseUrl(() => import(pathToFileURL(bundlePath).href));
  t.after(() => rm(tempBuildDir, { recursive: true, force: true }));

  type FailureMode = "clerk-update" | "journal-write" | "journal-write-after-persist" | "journal-verification-failure" | "journal-write-after-persist-verification-failure" | "restore-clerk" | "archive-write";
  const runFailureCase = async (mode: FailureMode) => {
    const admin = { id: "admin-1", publicMetadata: { itsmRole: "N1", itsmServiceIds: [] } };
    const target = { id: "target-1", publicMetadata: { itsmRole: "N5", itsmServiceIds: [], department: "Support" } };
    let updateCalls = 0;
    let lockCalls = 0;
    let audit: unknown[] = [];
    const alerts: Record<string, unknown>[] = [];
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const logger = {
        error: (fields: Record<string, unknown>, message: string) => {
          alerts.push({ ...fields, message });
        },
        warn: () => undefined,
      };
      (req as typeof req & { log: typeof logger }).log = logger;
      next();
    });
    app.use(createItsmRoleAssignmentRouter({
      checkStepUp: () => ({ ok: true }),
      resolveActor: async () => ({ id: admin.id, role: "N1", serviceIds: [] }),
      getUser: async (userId) => {
        if (userId === admin.id) return admin;
        if (userId === target.id) return target;
        throw new Error("Unknown account");
      },
      activeN1Ids: async () => [admin.id],
      updateUserMetadata: async (userId, metadata) => {
        updateCalls += 1;
        assert.equal(userId, target.id);
        if (mode === "restore-clerk" && updateCalls === 2) {
          throw new Error(`Simulated ${mode} failure`);
        }
        target.publicMetadata = metadata.publicMetadata;
        if (mode === "clerk-update" && updateCalls === 1) {
          throw new Error("Simulated Clerk timeout after metadata was updated");
        }
      },
      archiveRoleChange: async () => {
        if (mode === "archive-write") throw new Error("Simulated archive outage");
      },
      reportArchiveUnavailable: () => alerts.push({
        alert: "itsm_role_archive_unavailable",
        component: "itsm_role_archive",
        status: "unavailable",
        source: "role_change",
      }),
      withLock: async (operation) => {
        lockCalls += 1;
        if ((mode === "journal-verification-failure" || mode === "journal-write-after-persist-verification-failure") && lockCalls === 2) {
          throw new Error("Simulated journal verification failure");
        }
        return operation(
          { services: [], audit },
          async (nextStore) => {
            if (mode === "journal-write-after-persist" || mode === "journal-write-after-persist-verification-failure") {
              audit = structuredClone(nextStore.audit as unknown[]);
              throw new Error("Simulated network error after journal persistence");
            }
            if (mode !== "clerk-update") throw new Error("Simulated journal write failure");
            audit = structuredClone(nextStore.audit as unknown[]);
          },
        );
      },
    }, (_req, _res, next) => next()));

    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
      });
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const response = await fetch(
        `http://127.0.0.1:${address.port}/itsm/users/${target.id}/role`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role: "N2", serviceIds: [] }),
        },
      );
      const body = await response.json() as { error?: string };
      let retryStatus: number | null = null;
      let retryBody: { error?: string } | null = null;
      if (mode === "journal-write-after-persist-verification-failure") {
        const retryResponse = await fetch(
          `http://127.0.0.1:${address.port}/itsm/users/${target.id}/role`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ role: "N2", serviceIds: [] }),
          },
        );
        retryStatus = retryResponse.status;
        retryBody = await retryResponse.json() as { error?: string };
      }
      if (mode !== "journal-write-after-persist" && mode !== "journal-write-after-persist-verification-failure") {
        assert.equal(response.status, 503);
        assert.equal(audit.length, 0, "failed role changes must not appear in the audit");
      }
      return { body, target, updateCalls, alerts, audit, status: response.status, retryStatus, retryBody };
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  };

  await t.test("a failed initial Clerk update leaves role and journal unchanged", async () => {
    const result = await runFailureCase("clerk-update");
    assert.equal(result.target.publicMetadata.itsmRole, "N5");
    assert.equal(result.updateCalls, 2, "the route must attempt restoration when Clerk reports an update failure");
    assert.match(result.body.error ?? "", /Impossible de vérifier ou d’enregistrer/i);
    assert.equal(result.alerts.length, 0);
  });

  await t.test("an archive outage emits a distinct operational alert and restores the role", async () => {
    const result = await runFailureCase("archive-write");
    assert.equal(result.target.publicMetadata.itsmRole, "N5");
    assert.equal(result.updateCalls, 2);
    assert.equal(result.alerts.length, 1);
    assert.deepEqual(result.alerts[0], {
      alert: "itsm_role_archive_unavailable",
      component: "itsm_role_archive",
      status: "unavailable",
      source: "role_change",
    });
  });

  await t.test("a journal write failure restores the previous Clerk role", async () => {
    const result = await runFailureCase("journal-write");
    assert.equal(result.target.publicMetadata.itsmRole, "N5");
    assert.deepEqual(result.target.publicMetadata.itsmServiceIds, []);
    assert.equal(result.updateCalls, 2);
    assert.match(result.body.error ?? "", /Impossible de vérifier ou d’enregistrer/i);
    assert.equal(result.alerts.length, 0);
  });

  await t.test("a journal write and verification failure alerts without restoring the Clerk role", async () => {
    const result = await runFailureCase("journal-verification-failure");
    assert.equal(result.status, 503);
    assert.equal(result.target.publicMetadata.itsmRole, "N2");
    assert.deepEqual(result.target.publicMetadata.itsmServiceIds, []);
    assert.equal(result.updateCalls, 1, "the route must not automatically restore Clerk when journal persistence cannot be verified");
    assert.equal(result.audit.length, 0);
    assert.match(result.body.error ?? "", /journal est incertain/i);
    assert.match(result.body.error ?? "", /n’a pas été restauré automatiquement/i);
    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0].alert, "itsm_role_reconciliation_required");
    assert.equal(result.alerts[0].targetUserId, "target-1");
    assert.equal(result.alerts[0].expectedPreviousRole, "N5");
    assert.equal(result.alerts[0].requestedRole, "N2");
    assert.match(String(result.alerts[0].message), /audit persistence could not be verified/i);
  });

  await t.test("a journal persisted before a network error is confirmed without restoring Clerk", async () => {
    const result = await runFailureCase("journal-write-after-persist");
    assert.equal(result.status, 200);
    assert.equal(result.target.publicMetadata.itsmRole, "N2");
    assert.deepEqual(result.target.publicMetadata.itsmServiceIds, []);
    assert.equal(result.updateCalls, 1, "the route must not roll Clerk back when the audit trace exists");
    assert.equal(result.audit.length, 1);
    assert.equal((result.audit[0] as { type?: string }).type, "itsm.role.changed");
    assert.equal((result.audit[0] as { targetUserId?: string }).targetUserId, "target-1");
    assert.equal((result.audit[0] as { nextRole?: string }).nextRole, "N2");
    assert.deepEqual(findItsmRoleReconciliationIssues([
      { id: "target-1", role: "N2", serviceIds: [] },
    ], result.audit), []);
  });

  await t.test("retrying after uncertain journal verification reuses the existing role trace", async () => {
    const result = await runFailureCase("journal-write-after-persist-verification-failure");
    assert.equal(result.status, 503, "the first request must report the simulated verification uncertainty");
    assert.match(result.body.error ?? "", /journal est incertain/i);
    assert.equal(result.retryStatus, 200, "a retry should succeed once Clerk and the existing journal trace agree");
    assert.equal(result.retryBody?.error, undefined);
    assert.equal(result.target.publicMetadata.itsmRole, "N2", "the retry must leave the requested Clerk role in place");
    assert.deepEqual(result.target.publicMetadata.itsmServiceIds, []);
    assert.equal(result.updateCalls, 1, "the retry must not update Clerk again when the persisted role trace already matches");
    assert.equal(result.audit.length, 1, "the retry must not append a duplicate role trace");
    assert.equal((result.audit[0] as { type?: string }).type, "itsm.role.changed");
    assert.equal((result.audit[0] as { actor?: string }).actor, "admin-1");
    assert.equal((result.audit[0] as { targetUserId?: string }).targetUserId, "target-1");
    assert.equal((result.audit[0] as { previousRole?: string }).previousRole, "N5");
    assert.equal((result.audit[0] as { nextRole?: string }).nextRole, "N2");
    assert.deepEqual(findItsmRoleReconciliationIssues([
      { id: "target-1", role: "N2", serviceIds: [] },
    ], result.audit), []);
  });

  await t.test("a failed Clerk restoration returns an actionable alert", async () => {
    const result = await runFailureCase("restore-clerk");
    assert.equal(result.target.publicMetadata.itsmRole, "N2", "failed restoration leaves the requested Clerk role in place");
    assert.equal(result.updateCalls, 2);
    assert.match(result.body.error ?? "", /réconciliation/i);
    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0].alert, "itsm_role_reconciliation_required");
    assert.equal(result.alerts[0].targetUserId, "target-1");
    assert.equal(result.alerts[0].expectedPreviousRole, "N5");
    assert.equal(result.alerts[0].requestedRole, "N2");
    assert.match(String(result.alerts[0].procedure), /compare Clerk public metadata with the ITSM audit/i);
  });
});

test("the HTTP role route protects the last N1 and permits removal after an active replacement", async (t) => {
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const tempBuildDir = await mkdtemp(path.join(packageDir, "node_modules", ".itsm-last-n1-test-"));
  const tempNodeModules = path.join(tempBuildDir, "node_modules");
  await mkdir(tempNodeModules, { recursive: true });
  await symlink(
    path.resolve(packageDir, "../../lib/db/node_modules/pg"),
    path.join(tempNodeModules, "pg"),
  );
  const bundlePath = path.join(tempBuildDir, "itsm-role-route.mjs");
  await build({
    entryPoints: [path.join(packageDir, "src/routes/itsm.ts")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["@clerk/express", "express", "express-rate-limit", "pkijs", "asn1js", "pino", "pino-http", "pg"],
    sourcemap: false,
    logLevel: "silent",
  });
  const { createItsmRoleAssignmentRouter } = await importWithTestDatabaseUrl(() => import(pathToFileURL(bundlePath).href));
  t.after(() => rm(tempBuildDir, { recursive: true, force: true }));

  const soleAdmin = {
    id: "sole-n1",
    publicMetadata: { itsmRole: "N1", itsmServiceIds: [], department: "Sole admin" },
  };
  const replacement = {
    id: "replacement-n1",
    publicMetadata: { itsmRole: "N1", itsmServiceIds: [], department: "Replacement" },
  };
  const formerAdmin = {
    id: "former-n1",
    publicMetadata: { itsmRole: "N1", itsmServiceIds: [], department: "Former admin" },
  };
  const users = new Map([
    [soleAdmin.id, soleAdmin],
    [replacement.id, replacement],
    [formerAdmin.id, formerAdmin],
  ]);
  let actorId = soleAdmin.id;
  let activeAdmins = [soleAdmin.id];
  let audit: unknown[] = [];
  let updateCalls = 0;
  const archived: unknown[] = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { log: { error: () => void; warn: () => void } }).log = {
      error: () => undefined,
      warn: () => undefined,
    };
    next();
  });
  app.use(createItsmRoleAssignmentRouter({
      checkStepUp: () => ({ ok: true }),
    resolveActor: async () => ({ id: actorId, role: "N1", serviceIds: [] }),
    getUser: async (userId) => {
      const user = users.get(userId);
      if (!user) throw new Error("Unknown account");
      return user;
    },
    activeN1Ids: async () => activeAdmins,
    updateUserMetadata: async (userId, metadata) => {
      updateCalls += 1;
      const user = users.get(userId);
      assert.ok(user);
      user.publicMetadata = metadata.publicMetadata;
    },
    archiveRoleChange: async (event) => { archived.push(event); },
    reportArchiveUnavailable: () => undefined,
    withLock: async (operation) => operation(
      { services: [], audit },
      async (nextStore) => { audit = structuredClone(nextStore.audit as unknown[]); },
    ),
  }, (_req, _res, next) => next()));

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const endpoint = (userId: string) => `http://127.0.0.1:${address.port}/itsm/users/${userId}/role`;
    const removeAccess = (userId: string) => fetch(endpoint(userId), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: null, serviceIds: [] }),
    });

    const soleAdminBefore = structuredClone(soleAdmin.publicMetadata);
    const denied = await removeAccess(soleAdmin.id);
    const deniedBody = await denied.json() as { error?: string };
    assert.equal(denied.status, 403);
    assert.match(deniedBody.error ?? "", /dernier accès N1 actif/i);
    assert.deepEqual(soleAdmin.publicMetadata, soleAdminBefore);
    assert.equal(updateCalls, 0, "a refusal must not call Clerk");
    assert.equal(archived.length, 0, "a refusal must not archive a role event");
    assert.equal(audit.length, 0, "a refusal must not write the audit journal");

    actorId = replacement.id;
    activeAdmins = [replacement.id, formerAdmin.id];
    const removed = await removeAccess(formerAdmin.id);
    const removedBody = await removed.json() as { userId?: string; role?: string | null };
    assert.equal(removed.status, 200);
    assert.equal(removedBody.userId, formerAdmin.id);
    assert.equal(removedBody.role, null);
    assert.equal(formerAdmin.publicMetadata.itsmRole, null);
    assert.equal(updateCalls, 1, "the old N1 may be removed when another active N1 remains");
    assert.equal(archived.length, 1);
    assert.equal(audit.length, 1);
    assert.equal((audit[0] as { targetUserId?: string }).targetUserId, formerAdmin.id);
    assert.equal((audit[0] as { nextRole?: string | null }).nextRole, null);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("role attestations require N1 and preserve Clerk metadata while bootstrap is audited", async (t) => {
  const packageDir = fileURLToPath(new URL("..", import.meta.url));
  const tempBuildDir = await mkdtemp(path.join(packageDir, "node_modules", ".itsm-role-attestation-test-"));
  const tempNodeModules = path.join(tempBuildDir, "node_modules");
  await mkdir(tempNodeModules, { recursive: true });
  await symlink(
    path.resolve(packageDir, "../../lib/db/node_modules/pg"),
    path.join(tempNodeModules, "pg"),
  );
  const bundlePath = path.join(tempBuildDir, "itsm-role-attestation-route.mjs");
  await build({
    entryPoints: [path.join(packageDir, "src/routes/itsm.ts")],
    outfile: bundlePath,
    bundle: true,
    platform: "node",
    format: "esm",
    external: ["@clerk/express", "express", "express-rate-limit", "pkijs", "asn1js", "pino", "pino-http", "pg"],
    sourcemap: false,
    logLevel: "silent",
  });
  const { createItsmRoleAttestationRouter, createItsmBootstrapAdmin } = await importWithTestDatabaseUrl(() => import(pathToFileURL(bundlePath).href));
  t.after(() => rm(tempBuildDir, { recursive: true, force: true }));

  const admin = { id: "admin-n1", publicMetadata: { itsmRole: "N1", itsmServiceIds: [] } };
  const target = { id: "target-n1", publicMetadata: { itsmRole: "N1", itsmServiceIds: [] as string[] } };
  const originalMetadata = structuredClone(target.publicMetadata);
  let actorRole: "N1" | "N2" = "N1";
  let audit: unknown[] = [];
  const archived: Array<Record<string, unknown>> = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { log: { error: () => void; warn: () => void } }).log = {
      error: () => undefined,
      warn: () => undefined,
    };
    next();
  });
  // Step-up outcome for the N1 attestation (reverification of the session, see lib/itsm-step-up.ts).
  let stepUp: { ok: true } | { ok: false; reason: "reverification"; body: Record<string, unknown> } = { ok: true };
  app.use(createItsmRoleAttestationRouter({
    checkStepUp: () => stepUp,
    resolveActor: async () => ({
      id: admin.id,
      role: actorRole,
      serviceIds: [],
    }),
    getUser: async (userId) => {
      if (userId === admin.id) return admin;
      if (userId === target.id) return target;
      throw new Error("Unknown account");
    },
    archiveRoleChange: async (event) => { archived.push(event as unknown as Record<string, unknown>); },
    reportArchiveUnavailable: () => undefined,
    withLock: async (operation) => operation(
      { audit },
      async (nextStore) => { audit = structuredClone(nextStore.audit as unknown[]); },
    ),
  }, (_req, _res, next) => next()));

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}/itsm/users/${target.id}/role/attest`;
    const attestationRequest = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "N1", serviceIds: [] }),
    };
    const response = await fetch(endpoint, attestationRequest);
    const result = await response.json() as { userId?: string; role?: string; attestedAt?: string };
    assert.equal(response.status, 200);
    assert.equal(result.userId, target.id);
    assert.equal(result.role, "N1");
    assert.ok(result.attestedAt);
    assert.deepEqual(target.publicMetadata, originalMetadata, "attestation must not update Clerk metadata");
    assert.equal(audit.length, 1);
    assert.equal(archived.length, 1);
    assert.equal((audit[0] as { type?: string }).type, "itsm.role.attested");
    assert.equal((audit[0] as { actor?: string }).actor, admin.id);
    assert.equal((audit[0] as { targetUserId?: string }).targetUserId, target.id);
    assert.deepEqual(findItsmRoleReconciliationIssues([
      { id: target.id, role: "N1", serviceIds: [] },
    ], audit), []);

    stepUp = { ok: false, reason: "reverification", body: { clerk_error: { type: "forbidden", reason: "reverification-error" }, error: "Confirmez votre identité" } };
    const unverified = await fetch(endpoint, attestationRequest);
    assert.equal(unverified.status, 403, "a session not reverified recently cannot attest");
    assert.equal(((await unverified.json()) as { clerk_error?: { reason?: string } }).clerk_error?.reason, "reverification-error");
    assert.equal(audit.length, 1, "nothing is journaled without the step-up");
    stepUp = { ok: true };

    target.publicMetadata.itsmServiceIds = ["new-scope"];
    const stale = await fetch(endpoint, attestationRequest);
    assert.equal(stale.status, 409, "a changed scope must be reviewed again before attestation");
    assert.equal(audit.length, 1);
    actorRole = "N2";
    const denied = await fetch(endpoint, attestationRequest);
    assert.equal(denied.status, 403);
    assert.equal(audit.length, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }

  await t.test("the initial allowlisted bootstrap creates a role-change event", async () => {
    const user = {
      id: "first-admin",
      primaryEmailAddress: {
        emailAddress: "first-admin@example.test",
        verification: { status: "verified" },
      },
      publicMetadata: {},
    };
    let bootstrapStore: Record<string, unknown> = { audit: [] };
    const bootstrapArchive: Array<Record<string, unknown>> = [];
    let unavailableReports = 0;
    const bootstrap = createItsmBootstrapAdmin({
      getUser: async () => user,
      updateUserMetadata: async (_userId, metadata) => { user.publicMetadata = metadata.publicMetadata; },
      archiveRoleChange: async (event) => { bootstrapArchive.push(event as unknown as Record<string, unknown>); },
      reportArchiveUnavailable: () => { unavailableReports += 1; },
      withLock: async (operation) => operation(
        bootstrapStore,
        async (nextStore) => { bootstrapStore = structuredClone(nextStore); },
      ),
    });
    const bootstrappedUser = await bootstrap(user.id, "first-admin@example.test") as typeof user;
    assert.equal(bootstrappedUser.publicMetadata.itsmRole, "N1");
    assert.equal((bootstrapStore.audit as Array<{ type?: string }>)[0]?.type, "itsm.role.changed");
    assert.equal(bootstrapArchive.length, 1);
    assert.equal(bootstrapArchive[0]?.actor, "system:itsm-bootstrap");
    assert.equal(bootstrapArchive[0]?.origin, "bootstrap");
    assert.equal(unavailableReports, 0);
  });

  await t.test("an archive outage rolls back bootstrap metadata", async () => {
    const user = {
      id: "first-admin-outage",
      primaryEmailAddress: {
        emailAddress: "first-admin@example.test",
        verification: { status: "verified" },
      },
      publicMetadata: { existing: "kept" },
    };
    const original = structuredClone(user.publicMetadata);
    const bootstrapStore: Record<string, unknown> = { audit: [] };
    let unavailableReports = 0;
    const bootstrap = createItsmBootstrapAdmin({
      getUser: async () => user,
      updateUserMetadata: async (_userId, metadata) => { user.publicMetadata = metadata.publicMetadata; },
      archiveRoleChange: async () => { throw new Error("archive unavailable"); },
      reportArchiveUnavailable: () => { unavailableReports += 1; },
      withLock: async (operation) => operation(bootstrapStore, async () => undefined),
    });
    await assert.rejects(bootstrap(user.id, "first-admin@example.test"), /archive|archive/i);
    assert.deepEqual(user.publicMetadata, original);
    assert.equal((bootstrapStore.audit as unknown[]).length, 0);
    assert.equal(unavailableReports, 1);
  });
});

test("conversation writing and audit additions exclude N5 and N4 from conversation access", () => {
  for (const role of ["N1", "N2", "N3"] as const) {
    assert.equal(canPerform(actor(role), "manageConversations"), true);
  }
  assert.equal(canPerform(actor("N4"), "manageConversations"), false);
  assert.equal(canPerform(actor("N5"), "manageConversations"), false);
  assert.equal(canPerform(actor("N4"), "appendAudit"), true);
  assert.equal(canPerform(actor("N5"), "appendAudit"), false);
});

test("N4 ticket and knowledge views are restricted to assigned services", () => {
  const n4 = actor("N4", ["service-a"]);
  assert.equal(canPerform(n4, "manageTicket", "service-a"), true);
  assert.equal(canPerform(n4, "manageTicket", "service-b"), false);
  assert.equal(canPerform(n4, "createIncident"), true);
  assert.equal(canPerform(n4, "createProblem"), false);
  assert.equal(canPerform(n4, "createChange"), false);
});

test("N1 can name a replacement and can never remove the last active N1", () => {
  const manager = actor("N1");
  const twoAdmins = ["account-N1", "account-2"];
  assert.equal(canChangeItsmRole(manager, "account-2", "N5", "N1", twoAdmins), true);
  assert.equal(canChangeItsmRole(manager, "account-2", "N1", "N5", twoAdmins), true);
  assert.equal(canChangeItsmRole(manager, "account-2", "N1", null, twoAdmins), true);
  assert.equal(canChangeItsmRole(manager, manager.id, "N1", null, twoAdmins), true);
  assert.equal(canChangeItsmRole(manager, manager.id, "N1", null, [manager.id]), false);
  assert.equal(canChangeItsmRole(manager, "account-2", "N1", "N5", [manager.id, "account-2", "account-2"]), true);
  assert.equal(canChangeItsmRole(manager, manager.id, "N1", "N2", twoAdmins), false);
  assert.equal(canChangeItsmRole(actor("N2"), "account-3", null, "N1", twoAdmins), false);
  assert.equal(canChangeItsmRole(manager, "account-2", "N2", "N0", twoAdmins), false);
});

test("bootstrap grants N1 only to a configured, verified email and never restores revoked access", () => {
  assert.equal(isBootstrapAdmin("pilot@example.test", "verified", false, "pilot@example.test"), true);
  assert.equal(isBootstrapAdmin("PILOT@example.test", "verified", false, " pilot@example.test , other@example.test "), true);
  assert.equal(isBootstrapAdmin("pilot@example.test", "unverified", false, "pilot@example.test"), false);
  assert.equal(isBootstrapAdmin("pilot@example.test", "verified", true, "pilot@example.test"), false);
  // Every deliberate assignment or revocation records completion, preventing bootstrap re-grants.
  assert.equal(isBootstrapAdmin("pilot@example.test", "verified", true, "pilot@example.test"), false);
  assert.equal(isBootstrapAdmin("other@example.test", "verified", false, "pilot@example.test"), false);
});

test("bootstrap and deliberate revocation preserve unrelated metadata and cannot regrant N1", () => {
  const metadata = { department: "Pilote", itsmBootstrapCompleted: false };
  const initial = metadataForItsmBootstrap(metadata);
  assert.equal(initial.itsmRole, "N1");
  assert.deepEqual(initial.department, "Pilote");
  const manuallyAssigned = metadataForItsmRoleChange(metadata, "N1", []);
  assert.equal(initial.itsmBootstrapCompleted, manuallyAssigned.itsmBootstrapCompleted);
  assert.equal(isBootstrapAdmin("pilot@example.test", "verified", initial.itsmBootstrapCompleted, "pilot@example.test"), false);
  const revoked = metadataForItsmRoleChange(initial, null, ["ignored-service"]);
  assert.equal(revoked.itsmRole, null);
  assert.deepEqual(revoked.itsmServiceIds, []);
  assert.equal(revoked.itsmBootstrapCompleted, true);
  assert.equal(isBootstrapAdmin("pilot@example.test", "verified", revoked.itsmBootstrapCompleted, "pilot@example.test"), false);
  assert.deepEqual(metadataForItsmRoleChange(metadata, "N3", ["service-a", "service-a"]).itsmServiceIds, ["service-a"]);
});
