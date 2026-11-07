import type { Logger } from "pino";

export const ITSM_ROLE_ARCHIVE_UNAVAILABLE_ALERT = "itsm_role_archive_unavailable";
export const ITSM_ROLE_ARCHIVE_RECOVERED_ALERT = "itsm_role_archive_recovered";
export const ITSM_ROLE_ARCHIVE_ALERT_DELIVERY_FAILED = "itsm_role_archive_alert_delivery_failed";

export type ItsmRoleArchiveSignalSource = "periodic_health_check" | "role_change" | "role_attestation";

export type ItsmRoleArchiveAlert = {
  alert: typeof ITSM_ROLE_ARCHIVE_UNAVAILABLE_ALERT | typeof ITSM_ROLE_ARCHIVE_RECOVERED_ALERT;
  component: "itsm_role_archive";
  status: "unavailable" | "available";
  source: ItsmRoleArchiveSignalSource;
};

export type ItsmRoleArchiveAlertNotifier = (alert: ItsmRoleArchiveAlert) => Promise<void>;

type OperationalLogger = Pick<Logger, "error" | "info">;

function notifyOperationalChannel(
  logger: OperationalLogger,
  alert: ItsmRoleArchiveAlert,
  notify?: ItsmRoleArchiveAlertNotifier,
): void {
  if (!notify) return;
  void Promise.resolve().then(() => notify(alert)).catch(() => {
    logger.error({
      alert: ITSM_ROLE_ARCHIVE_ALERT_DELIVERY_FAILED,
      component: "itsm_role_archive",
      source: alert.source,
    }, "ITSM_ROLE_ARCHIVE_ALERT_DELIVERY_FAILED");
  });
}

export function reportItsmRoleArchiveUnavailable(
  logger: OperationalLogger,
  source: ItsmRoleArchiveSignalSource,
  notify?: ItsmRoleArchiveAlertNotifier,
): void {
  const alert: ItsmRoleArchiveAlert = {
    alert: ITSM_ROLE_ARCHIVE_UNAVAILABLE_ALERT,
    component: "itsm_role_archive",
    status: "unavailable",
    source,
  };
  logger.error(alert, "ITSM_ROLE_ARCHIVE_UNAVAILABLE");
  notifyOperationalChannel(logger, alert, notify);
}

export function createItsmRoleArchiveHealthMonitor(options: {
  checkArchiveConnection: () => Promise<void>;
  logger: OperationalLogger;
  notify?: ItsmRoleArchiveAlertNotifier;
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
        const alert: ItsmRoleArchiveAlert = {
          alert: ITSM_ROLE_ARCHIVE_RECOVERED_ALERT,
          component: "itsm_role_archive",
          status: "available",
          source: "periodic_health_check",
        };
        options.logger.info(alert, "ITSM_ROLE_ARCHIVE_RECOVERED");
        notifyOperationalChannel(options.logger, alert, options.notify);
      }
      status = "available";
    } catch {
      if (status !== "unavailable") {
        reportItsmRoleArchiveUnavailable(options.logger, "periodic_health_check", options.notify);
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
