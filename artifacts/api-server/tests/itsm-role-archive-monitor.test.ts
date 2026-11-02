import assert from "node:assert/strict";
import test from "node:test";
import {
  createItsmRoleArchiveHealthMonitor,
  reportItsmRoleArchiveUnavailable,
} from "../src/lib/itsm-role-archive-monitor.ts";

test("archive health checks emit one sanitized alert per outage and a recovery event", async () => {
  const events: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];
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
  });

  await monitor.checkNow();
  await monitor.checkNow();
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

  available = true;
  await monitor.checkNow();
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
