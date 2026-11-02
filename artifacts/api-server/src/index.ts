import app from "./app";
import { logger } from "./lib/logger";
import { createItsmRoleReconciliationMonitor } from "./lib/itsm-workspace";
import { createItsmRoleArchiveHealthMonitor } from "./lib/itsm-role-archive-monitor";
import { checkItsmRoleArchiveAvailability, scanItsmRoleReconciliation } from "./routes/itsm";
import { developmentRoleArchiveEnabled } from "./lib/development-role-archive-config";
import { initializeDevelopmentRoleArchive } from "./lib/development-role-archive-storage";

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
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    createItsmRoleArchiveHealthMonitor({
      checkArchiveConnection: checkItsmRoleArchiveAvailability,
      logger,
    }).start();
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
