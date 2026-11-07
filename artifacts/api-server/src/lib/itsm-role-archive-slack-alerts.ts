import type { ItsmRoleArchiveAlert } from "./itsm-role-archive-monitor";

export function formatItsmRoleArchiveAlert(alert: ItsmRoleArchiveAlert): string {
  const title = alert.alert === "itsm_role_archive_unavailable"
    ? "ITSM role archive unavailable"
    : "ITSM role archive recovered";

  return [
    title,
    `Event: ${alert.alert}`,
    `Status: ${alert.status}`,
    `Source: ${alert.source}`,
  ].join("\n");
}

export async function notifyItsmRoleArchiveAlert(alert: ItsmRoleArchiveAlert): Promise<void> {
  const channel = process.env.ITSM_ROLE_ARCHIVE_ALERT_CHANNEL_ID?.trim();
  if (!channel) {
    throw new Error("ITSM_ROLE_ARCHIVE_ALERT_CHANNEL_ID is not configured");
  }

  const { ReplitConnectors } = await import("@replit/connectors-sdk");
  const connectors = new ReplitConnectors();
  const response = await connectors.proxy("slack", "/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel,
      text: formatItsmRoleArchiveAlert(alert),
    }),
  });
  const result = await response.json() as { ok?: boolean };
  if (!response.ok || result.ok !== true) {
    throw new Error("Slack did not accept the ITSM archive alert");
  }
}
