/**
 * Server-side record of SLA breaches. The browser already shows its own
 * countdowns and alerts; this adds a journal trace (time, priority, level,
 * assignee) and an operational log alert, once per ticket and deadline.
 *
 * Same demonstration rules as the browser (docs/specification-coverage.md):
 * continuous time from the initial opening, no business hours or holidays.
 */

type JsonRecord = Record<string, unknown>;

export const ITSM_SLA_BREACH_AUDIT_TYPE = "itsm.sla.breached";
export const SLA_MONITOR_ACTOR = "system:sla-monitor";

export const SLA_POLICY_MINUTES: Readonly<Record<string, { acknowledge: number; resolve: number }>> = {
  P1: { acknowledge: 15, resolve: 120 },
  P2: { acknowledge: 30, resolve: 240 },
  P3: { acknowledge: 120, resolve: 480 },
  P4: { acknowledge: 240, resolve: 2880 },
};

const CLOSED_STATUSES = new Set(["Clos", "Rejeté"]);

export type SlaBreach = {
  ticketId: string;
  deadline: "acknowledge" | "resolve";
  priority: string;
  dueAt: string;
  supportLevel: unknown;
  assignee: unknown;
  serviceId: string | null;
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const breachKey = (ticketId: string, deadline: string) => `${ticketId}:${deadline}`;

/** Breaches due at `now` that the journal does not record yet. */
export function findNewSlaBreaches(tickets: unknown, audit: unknown, now: Date): SlaBreach[] {
  const recorded = new Set((Array.isArray(audit) ? audit : []).filter(isRecord)
    .filter((event) => event.type === ITSM_SLA_BREACH_AUDIT_TYPE)
    .map((event) => breachKey(String(event.ticketId), String(event.deadline))));
  const breaches: SlaBreach[] = [];
  for (const ticket of (Array.isArray(tickets) ? tickets : []).filter(isRecord)) {
    if (CLOSED_STATUSES.has(String(ticket.status))) continue;
    const policy = SLA_POLICY_MINUTES[String(ticket.priority)];
    const opened = typeof ticket.openedAt === "string" ? Date.parse(ticket.openedAt) : Number.NaN;
    if (!policy || !Number.isFinite(opened) || typeof ticket.id !== "string") continue;
    const checks = [
      { deadline: "acknowledge" as const, minutes: policy.acknowledge, completedAt: ticket.acknowledgedAt },
      { deadline: "resolve" as const, minutes: policy.resolve, completedAt: ticket.resolvedAt },
    ];
    for (const { deadline, minutes, completedAt } of checks) {
      const due = opened + minutes * 60_000;
      const completed = typeof completedAt === "string" && completedAt ? Date.parse(completedAt) : Number.NaN;
      // Completed in time, or not due yet: nothing to record. A late completion is still a breach.
      if (Number.isFinite(completed) ? completed <= due : now.getTime() <= due) continue;
      if (recorded.has(breachKey(ticket.id, deadline))) continue;
      breaches.push({
        ticketId: ticket.id,
        deadline,
        priority: String(ticket.priority),
        dueAt: new Date(due).toISOString(),
        supportLevel: ticket.supportLevel,
        assignee: ticket.assignee,
        serviceId: typeof ticket.serviceId === "string" ? ticket.serviceId : null,
      });
    }
  }
  return breaches;
}

export function slaBreachAuditEvent(breach: SlaBreach, id: string, at: string, time: string): JsonRecord {
  const what = breach.deadline === "acknowledge" ? "Délai de prise en charge" : "Délai de résolution";
  return {
    id,
    type: ITSM_SLA_BREACH_AUDIT_TYPE,
    action: `${what} dépassé pour ${breach.ticketId} (${breach.priority})`,
    actor: SLA_MONITOR_ACTOR,
    scope: `Ticket ${breach.ticketId}`,
    ticketId: breach.ticketId,
    deadline: breach.deadline,
    priority: breach.priority,
    dueAt: breach.dueAt,
    supportLevel: breach.supportLevel,
    assignee: breach.assignee,
    serviceId: breach.serviceId,
    at,
    time,
  };
}

type MonitorLogger = { warn: (fields: JsonRecord, message: string) => void; error: (fields: JsonRecord, message: string) => void };

/** Checks open tickets every minute and records each new breach once. */
export function createSlaBreachMonitor(options: {
  recordNow: () => Promise<SlaBreach[]>;
  logger: MonitorLogger;
  intervalMs?: number;
}) {
  let running = false;
  let timer: NodeJS.Timeout | undefined;
  const checkNow = async (): Promise<SlaBreach[]> => {
    if (running) return [];
    running = true;
    try {
      const breaches = await options.recordNow();
      for (const breach of breaches) {
        options.logger.warn({ alert: "itsm_sla_breached", ...breach }, "ITSM_SLA_BREACHED");
      }
      return breaches;
    } catch (err) {
      options.logger.error({ err, component: "itsm_sla_monitor" }, "Could not check SLA deadlines");
      return [];
    } finally {
      running = false;
    }
  };
  return {
    checkNow,
    start() {
      timer ??= setInterval(() => { void checkNow(); }, options.intervalMs ?? 60_000);
      timer.unref?.();
      void checkNow();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
