import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  createItsmRoleArchiveHealthMonitor,
  reportItsmRoleArchiveUnavailable,
  type ItsmRoleArchiveAlert,
} from "../src/lib/itsm-role-archive-monitor.ts";
import { formatItsmRoleArchiveAlert } from "../src/lib/itsm-role-archive-slack-alerts.ts";
import { checkItsmRoleArchiveConnection } from "../src/lib/itsm-workspace.ts";

test("periodic archive monitoring alerts once during an outage and reports recovery", async () => {
  const events: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];
  const delivered: ItsmRoleArchiveAlert[] = [];
  let available = false;
  let probeCount = 0;
  const archiveServer = createServer((request, response) => {
    probeCount += 1;
    assert.equal(request.method, "HEAD");
    response.writeHead(available ? 204 : 503).end();
  });

  await new Promise<void>((resolve, reject) => {
    archiveServer.once("error", reject);
    archiveServer.listen(0, "127.0.0.1", resolve);
  });

  const address = archiveServer.address();
  assert.ok(address && typeof address !== "string");
  const localArchiveUrl = `http://127.0.0.1:${address.port}/health`;
  const logger = {
    error: (fields: Record<string, unknown>, message: string) => events.push({ level: "error", fields, message }),
    info: (fields: Record<string, unknown>, message: string) => events.push({ level: "info", fields, message }),
  };
  const monitor = createItsmRoleArchiveHealthMonitor({
    checkArchiveConnection: () => checkItsmRoleArchiveConnection({
      url: "https://archive.example.invalid/health",
      token: "private-archive-token",
      fetchImpl: async (_input, init) => fetch(localArchiveUrl, init),
    }),
    logger: logger as never,
    notify: async (alert) => {
      delivered.push(alert);
    },
    intervalMs: 10,
  });

  const waitFor = async (condition: () => boolean): Promise<void> => {
    const deadline = Date.now() + 2_000;
    while (!condition()) {
      if (Date.now() >= deadline) throw new Error("Timed out waiting for periodic archive checks.");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  try {
    monitor.start();
    await waitFor(() => probeCount >= 4 && delivered.length === 1);
    assert.equal(events.length, 1);
    assert.deepEqual(delivered, [{
      alert: "itsm_role_archive_unavailable",
      component: "itsm_role_archive",
      status: "unavailable",
      source: "periodic_health_check",
    }]);

    available = true;
    await waitFor(() => delivered.length === 2);
    monitor.stop();

    assert.equal(events.length, 2);
    assert.deepEqual(events[0], {
      level: "error",
      fields: {
        alert: "itsm_role_archive_unavailable",
        component: "itsm_role_archive",
        status: "unavailable",
        source: "periodic_health_check",
      },
      message: "ITSM_ROLE_ARCHIVE_UNAVAILABLE",
    });
    assert.deepEqual(events[1], {
      level: "info",
      fields: {
        alert: "itsm_role_archive_recovered",
        component: "itsm_role_archive",
        status: "available",
        source: "periodic_health_check",
      },
      message: "ITSM_ROLE_ARCHIVE_RECOVERED",
    });
    assert.doesNotMatch(JSON.stringify({ events, delivered }), /private-archive-token|archive\.example\.invalid/i);
  } finally {
    monitor.stop();
    await new Promise<void>((resolve, reject) => {
      archiveServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("archive health checks emit one sanitized alert per outage and a recovery event", async () => {
  const events: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];
  const delivered: ItsmRoleArchiveAlert[] = [];
  let available = false;
  const logger = {
    error: (fields: Record<string, unknown>, message: string) => events.push({ level: "error", fields, message }),
    info: (fields: Record<string, unknown>, message: string) => events.push({ level: "info", fields, message }),
  };
  const monitor = createItsmRoleArchiveHealthMonitor({
    checkArchiveConnection: async () => {
      if (!available) throw new Error("private endpoint or credential must not be logged");
    },
    logger: logger as never,
    notify: async (alert) => {
      delivered.push(alert);
    },
  });

  await monitor.checkNow();
  await monitor.checkNow();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    level: "error",
    fields: {
      alert: "itsm_role_archive_unavailable",
      component: "itsm_role_archive",
      status: "unavailable",
      source: "periodic_health_check",
    },
    message: "ITSM_ROLE_ARCHIVE_UNAVAILABLE",
  });
  assert.doesNotMatch(JSON.stringify(events), /private endpoint|credential/i);
  assert.deepEqual(delivered, [{
    alert: "itsm_role_archive_unavailable",
    component: "itsm_role_archive",
    status: "unavailable",
    source: "periodic_health_check",
  }]);

  available = true;
  await monitor.checkNow();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(events.length, 2);
  assert.deepEqual(events[1], {
    level: "info",
    fields: {
      alert: "itsm_role_archive_recovered",
      component: "itsm_role_archive",
      status: "available",
      source: "periodic_health_check",
    },
    message: "ITSM_ROLE_ARCHIVE_RECOVERED",
  });
  assert.deepEqual(delivered[1], {
    alert: "itsm_role_archive_recovered",
    component: "itsm_role_archive",
    status: "available",
    source: "periodic_health_check",
  });
  assert.match(formatItsmRoleArchiveAlert(delivered[0]!), /^ITSM role archive unavailable/);
  assert.match(formatItsmRoleArchiveAlert(delivered[1]!), /^ITSM role archive recovered/);
  assert.doesNotMatch(delivered.map(formatItsmRoleArchiveAlert).join("\n"), /credential|endpoint|account|token/i);
});

test("role-change archive alerts contain no account or authorization data", () => {
  const events: Array<{ fields: Record<string, unknown>; message: string }> = [];
  const logger = {
    error: (fields: Record<string, unknown>, message: string) => events.push({ fields, message }),
    info: () => undefined,
  };

  reportItsmRoleArchiveUnavailable(logger as never, "role_change");

  assert.deepEqual(events, [{
    fields: {
      alert: "itsm_role_archive_unavailable",
      component: "itsm_role_archive",
      status: "unavailable",
      source: "role_change",
    },
    message: "ITSM_ROLE_ARCHIVE_UNAVAILABLE",
  }]);
});

test("Slack alert formatting uses only the allowlisted operational fields", () => {
  assert.equal(formatItsmRoleArchiveAlert({
    alert: "itsm_role_archive_unavailable",
    component: "itsm_role_archive",
    status: "unavailable",
    source: "role_attestation",
  }), "ITSM role archive unavailable\nEvent: itsm_role_archive_unavailable\nStatus: unavailable\nSource: role_attestation");
  assert.equal(formatItsmRoleArchiveAlert({
    alert: "itsm_role_archive_recovered",
    component: "itsm_role_archive",
    status: "available",
    source: "periodic_health_check",
  }), "ITSM role archive recovered\nEvent: itsm_role_archive_recovered\nStatus: available\nSource: periodic_health_check");
});

test("failed Slack delivery logs only a sanitized delivery failure", async () => {
  const events: Array<{ fields: Record<string, unknown>; message: string }> = [];
  const logger = {
    error: (fields: Record<string, unknown>, message: string) => events.push({ fields, message }),
    info: () => undefined,
  };

  reportItsmRoleArchiveUnavailable(logger as never, "role_change", async () => {
    throw new Error("private channel token and account identifier");
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(events, [
    {
      fields: {
        alert: "itsm_role_archive_unavailable",
        component: "itsm_role_archive",
        status: "unavailable",
        source: "role_change",
      },
      message: "ITSM_ROLE_ARCHIVE_UNAVAILABLE",
    },
    {
      fields: {
        alert: "itsm_role_archive_alert_delivery_failed",
        component: "itsm_role_archive",
        source: "role_change",
      },
      message: "ITSM_ROLE_ARCHIVE_ALERT_DELIVERY_FAILED",
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /private channel|token|account identifier/i);
});
