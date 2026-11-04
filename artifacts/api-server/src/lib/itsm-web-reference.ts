import { randomUUID } from "node:crypto";
import { canPerform } from "./itsm-rbac.ts";
import type { WorkspaceActor } from "./itsm-workspace.ts";

type JsonRecord = Record<string, unknown>;

export const ITSM_TICKET_WEB_REFERENCE_AUDIT_TYPE = "itsm.ticket.web_reference";
/** Same ceiling the workspace save applies to a ticket update body. */
export const WEB_REFERENCE_UPDATE_MAX_LENGTH = 5000;
export const WEB_REFERENCE_NOTE_MAX_LENGTH = 500;
export const WEB_REFERENCE_MAX_PER_TICKET = 20;
const WEB_REFERENCE_MARKER = "Référence web ajoutée";
const CLOSED_STATUSES = new Set(["Clos", "Rejeté"]);

export class WebReferenceRejectedError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WebReferenceRejectedError";
    this.status = status;
  }
}

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
const records = (value: unknown) => Array.isArray(value) ? value.filter(isRecord) : [];
const shortTime = (now: Date) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Libreville", hour: "2-digit", minute: "2-digit",
}).format(now);

/** Single-line text: page titles and notes must not inject extra lines into the update. */
function oneLine(value: string, max: number): string {
  const text = value.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Keeps readable text only: images and embedded data are dropped, blank runs collapsed. */
export function excerptFromMarkdown(markdown: string, maxLength: number): string {
  const cleaned = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  if (maxLength <= 1) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
}

export function webReferenceUpdateBody(reference: {
  url: string;
  title: string | null;
  markdown: string;
  note: string | null;
}): string {
  const lines = [
    `${WEB_REFERENCE_MARKER} : ${oneLine(reference.title ?? reference.url, 200)}`,
    `Source : ${reference.url}`,
  ];
  if (reference.note) lines.push(`Note : ${oneLine(reference.note, WEB_REFERENCE_NOTE_MAX_LENGTH)}`);
  lines.push("", "Extrait récupéré automatiquement (contenu externe, non vérifié) :", "");
  const header = lines.join("\n");
  const excerpt = excerptFromMarkdown(reference.markdown, WEB_REFERENCE_UPDATE_MAX_LENGTH - header.length);
  return `${header}${excerpt}`;
}

/**
 * Checks, before any page is fetched, that the actor may annotate this ticket.
 * Agents outside a ticket's service scope receive 404, as the ticket is hidden from them.
 */
export function assertCanAddWebReference(store: JsonRecord, ticketId: string, actor: WorkspaceActor): JsonRecord {
  const ticket = records(store.tickets).find((candidate) => String(candidate.id) === ticketId);
  const hiddenFromActor = actor.role === "N5"
    || (actor.role === "N4" && !actor.serviceIds.includes(String(ticket?.serviceId ?? "")));
  if (!ticket || hiddenFromActor) throw new WebReferenceRejectedError("Ticket introuvable.", 404);
  if (!canPerform(actor, "manageTicket", typeof ticket.serviceId === "string" ? ticket.serviceId : null)) {
    throw new WebReferenceRejectedError("Votre rôle ne permet pas d’ajouter une référence à ce ticket.", 403);
  }
  if (CLOSED_STATUSES.has(String(ticket.status))) {
    throw new WebReferenceRejectedError("Ce ticket est clos; aucune référence ne peut plus y être ajoutée.", 409);
  }
  const existing = records(ticket.updates)
    .filter((update) => typeof update.body === "string" && update.body.startsWith(WEB_REFERENCE_MARKER)).length;
  if (existing >= WEB_REFERENCE_MAX_PER_TICKET) {
    throw new WebReferenceRejectedError(
      `Ce ticket compte déjà ${WEB_REFERENCE_MAX_PER_TICKET} références web, la limite du pilote.`,
      409,
    );
  }
  return ticket;
}

export function appendTicketWebReference(
  store: JsonRecord,
  ticketId: string,
  reference: { url: string; title: string | null; markdown: string; note: string | null },
  actor: WorkspaceActor,
  now = new Date(),
): { store: JsonRecord; update: { author: string; body: string; at: string; time: string } } {
  // Re-checked inside the workspace lock: the ticket may have closed while the page loaded.
  assertCanAddWebReference(store, ticketId, actor);
  const next = structuredClone(store);
  const at = now.toISOString();
  const time = shortTime(now);
  const update = { author: actor.id, body: webReferenceUpdateBody(reference), at, time };
  next.tickets = records(next.tickets).map((ticket) => String(ticket.id) === ticketId
    ? { ...ticket, updates: [...records(ticket.updates), update] }
    : ticket);
  const event = {
    id: randomUUID(),
    type: ITSM_TICKET_WEB_REFERENCE_AUDIT_TYPE,
    action: `Référence web ajoutée au ticket ${ticketId}`,
    actor: actor.id,
    scope: `Ticket ${ticketId}`,
    ticketId,
    url: reference.url,
    at,
    time,
  };
  next.audit = [event, ...records(next.audit)].slice(0, 5000);
  return { store: next, update };
}
