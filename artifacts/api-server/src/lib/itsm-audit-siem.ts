/**
 * Journal events in a shape a SIEM ingests directly (one JSON object per line,
 * field names after the Elastic Common Schema). A collector polls with the last
 * sequence it received (`after`) and gets the following events in order, each
 * with its seal so the SIEM can check the chain on its own side.
 *
 * Only listed fields leave the pilot: an unknown field added to an event later
 * is not exported until it is mapped here.
 */

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const list = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined);
const integer = (value: unknown) => (Number.isSafeInteger(value) ? value as number : undefined);

/** Drop undefined values so the lines stay compact. */
const compact = <T extends JsonRecord>(record: T): T =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined
    && !(isRecord(value) && Object.keys(value).length === 0))) as T;

function category(type: string): { category: string[]; type: string[] } {
  if (type.startsWith("itsm.role.")) return { category: ["iam"], type: type === "itsm.role.attested" ? ["info"] : ["change"] };
  if (type === "itsm.request.approved" || type === "itsm.request.rejected") return { category: ["process"], type: ["change"] };
  if (type.startsWith("itsm.sla.")) return { category: ["process"], type: ["info"] };
  if (type === "itsm.messages.expired") return { category: ["file"], type: ["deletion"] };
  return { category: ["configuration"], type: ["change"] };
}

export function toSiemRecord(event: JsonRecord): JsonRecord {
  const type = text(event.type) ?? "itsm.activity";
  const classes = category(type);
  return compact({
    "@timestamp": text(event.at),
    message: text(event.action),
    event: compact({
      id: text(event.id),
      kind: "event",
      dataset: "anif.itsm.audit",
      action: type,
      category: classes.category,
      type: classes.type,
      sequence: integer(event.seq),
    }),
    user: compact({ id: text(event.actor), target: text(event.targetUserId) ? { id: text(event.targetUserId) } : undefined }),
    observer: { vendor: "ANIF Gabon", product: "Poste de pilotage ITSM", type: "application" },
    anif: compact({
      scope: text(event.scope),
      seal: compact({ seq: integer(event.seq), prev_hash: text(event.prevHash), hash: text(event.hash) }),
      role: compact({
        previous: text(event.previousRole),
        next: event.nextRole === null ? null : text(event.nextRole),
        previous_service_ids: list(event.previousServiceIds),
        service_ids: list(event.serviceIds),
      }),
      ticket: compact({
        id: text(event.ticketId),
        priority: text(event.priority),
        service_id: text(event.serviceId),
        assignee: text(event.assignee),
        support_level: integer(event.supportLevel) ?? text(event.supportLevel),
        due_at: text(event.dueAt),
        deadline: text(event.deadline),
      }),
      sla: compact({ rule: text(event.rule), escalation_key: text(event.escalationKey), recipients: list(event.recipients) }),
      conversation: compact({ id: text(event.conversationId), source_message_id: text(event.sourceMessageId) }),
      count: integer(event.count),
    }),
  });
}

export type SiemPage = { lines: string[]; next: number; head: number };

/**
 * Sealed events after sequence `after`, oldest first, at most `limit`.
 * Pruned stubs carry no content and are skipped, but the cursor still moves past them.
 */
export function siemPage(events: readonly unknown[], after: number, limit: number): SiemPage {
  const sealed = events.filter(isRecord).filter((event) => Number.isSafeInteger(event.seq))
    .sort((left, right) => (left.seq as number) - (right.seq as number));
  const head = sealed.length ? sealed.at(-1)!.seq as number : 0;
  const lines: string[] = [];
  let next = after;
  for (const event of sealed) {
    const seq = event.seq as number;
    if (seq <= after) continue;
    if (lines.length >= limit) break;
    next = seq;
    if (event.pruned === true) continue;
    lines.push(JSON.stringify(toSiemRecord(event)));
  }
  return { lines, next, head };
}
