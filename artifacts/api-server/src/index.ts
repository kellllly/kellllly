import app from "./app";
import { logger } from "./lib/logger";
import { createItsmRoleReconciliationMonitor } from "./lib/itsm-workspace";
import { createItsmRoleArchiveHealthMonitor } from "./lib/itsm-role-archive-monitor";
import { notifyItsmRoleArchiveAlert } from "./lib/itsm-role-archive-slack-alerts";
import { checkItsmRoleArchiveAvailability, purgeExpiredMessagesNow, recordSlaBreachesNow, scanItsmRoleReconciliation, sealStoredAuditJournal, ensureSupportServiceChannelsNow } from "./routes/itsm";
import { createSlaBreachMonitor } from "./lib/itsm-sla";
import { developmentRoleArchiveEnabled } from "./lib/development-role-archive-config";
import { initializeDevelopmentRoleArchive } from "./lib/development-role-archive-storage";
import { installAuditWorm } from "./lib/itsm-audit-worm";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  if (developmentRoleArchiveEnabled()) await initializeDevelopmentRoleArchive();
  try {
    if (await sealStoredAuditJournal()) logger.info({ component: "itsm_audit_chain" }, "Existing activity journal sealed");
  } catch (err) {
    // Not fatal: the journal is also sealed at the next workspace save.
    logger.error({ err, component: "itsm_audit_chain" }, "Could not seal the existing activity journal");
  }
  try {
    // After sealing: the triggers archive the seals of the journal as it stands.
    const archived = await installAuditWorm(pool);
    logger.info({ component: "itsm_audit_worm", archived }, "Append-only seal archive installed");
  } catch (err) {
    // Not fatal: the integrity check then reports the archive as not installed or diverged.
    logger.error({ err, component: "itsm_audit_worm", alert: "itsm_audit_worm_install_failed" }, "Could not install the append-only seal archive");
  }
  try {
    if (await ensureSupportServiceChannelsNow()) logger.info({ component: "itsm_support_channels" }, "Announcements channel and support services room opened");
  } catch (err) {
    logger.error({ err, component: "itsm_support_channels" }, "Could not open the support services channels");
  }
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    createItsmRoleArchiveHealthMonitor({
      checkArchiveConnection: checkItsmRoleArchiveAvailability,
      logger,
      notify: notifyItsmRoleArchiveAlert,
    }).start();
    createSlaBreachMonitor({ recordNow: recordSlaBreachesNow, logger }).start();
    const purgeEphemeral = () => void purgeExpiredMessagesNow()
      .then((count) => { if (count) logger.info({ component: "itsm_ephemeral_messages", count }, "Expired ephemeral messages erased"); })
      .catch((err) => logger.error({ err, component: "itsm_ephemeral_messages" }, "Could not erase expired messages"));
    setInterval(purgeEphemeral, 15_000).unref();
    purgeEphemeral();
    createItsmRoleReconciliationMonitor({
      scan: scanItsmRoleReconciliation,
      logger,
    }).start();
    logger.info({ port }, "Server listening");
  });
}

void start().catch(() => {
  logger.error({ component: "api_startup" }, "Could not initialize the API storage");
  process.exit(1);
});
