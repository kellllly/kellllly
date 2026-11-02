import type { Logger } from "pino";

export const ITSM_ROLE_ARCHIVE_UNAVAILABLE_ALERT = "itsm_role_archive_unavailable";
export const ITSM_ROLE_ARCHIVE_RECOVERED_ALERT = "itsm_role_archive_recovered";

export type ItsmRoleArchiveSignalSource = "periodic_health_check" | "role_change" | "role_attestation";

type OperationalLogger = Pick<Logger, "error" | "info">;

export function reportItsmRoleArchiveUnavailable(
  logger: OperationalLogger,
  source: ItsmRoleArchiveSignalSource,
): void {
  logger.error({
    alert: ITSM_ROLE_ARCHIVE_UNAVAILABLE_ALERT,
    component: "itsm_role_archive",
    status: "unavailable",
    source,
  }, "ITSM_ROLE_ARCHIVE_UNAVAILABLE");
}

export function createItsmRoleArchiveHealthMonitor(options: {
  checkArchiveConnection: () => Promise<void>;
  logger: OperationalLogger;
  intervalMs?: number;
}) {
  let status: "unknown" | "available" | "unavailable" = "unknown";
  let checkInProgress = false;
  let timer: NodeJS.Timeout | undefined;

  const checkNow = async (): Promise<void> => {
    if (checkInProgress) return;
    checkInProgress = true;
    try {
      await options.checkArchiveConnection();
      if (status === "unavailable") {
        options.logger.info({
          alert: ITSM_ROLE_ARCHIVE_RECOVERED_ALERT,
          component: "itsm_role_archive",
          status: "available",
          source: "periodic_health_check",
        }, "ITSM_ROLE_ARCHIVE_RECOVERED");
      }
      status = "available";
    } catch {
      if (status !== "unavailable") {
        reportItsmRoleArchiveUnavailable(options.logger, "periodic_health_check");
      }
      status = "unavailable";
    } finally {
      checkInProgress = false;
    }
  };

  return {
    checkNow,
    start(): void {
      if (timer) return;
      void checkNow();
      timer = setInterval(() => void checkNow(), options.intervalMs ?? 60_000);
      timer.unref();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
