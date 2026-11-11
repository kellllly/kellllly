import { formatWAT, getDeadlines, slaProgress, toCsv, type Priority } from './itsm';
import type { Conversation, Store, Ticket, TicketKind, TicketStatus } from './types';

export const KINDS: TicketKind[] = ['Incident', 'Demande', 'Problème', 'Changement'];
export const STATUSES: TicketStatus[] = ['Nouveau', 'Pris en compte', 'En cours', 'En attente', 'Résolu', 'Clos', 'Rejeté'];
export const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4'];
export const LEVEL_LABEL: Record<number, string> = { 1: '1 · fort', 2: '2 · moyen', 3: '3 · faible' };
export const ASSIGNEES = ['Équipe support', 'Olivier Nguema', 'Jean-Pierre Obame', 'Équipe infrastructure', 'Support applicatif'];
export const CATEGORIES = ['Applications', 'Poste de travail', 'Équipement', 'Réseau', 'Accès'];
const PREFIX: Record<TicketKind, string> = { Incident: 'INC', Demande: 'REQ', Problème: 'PRB', Changement: 'CHG' };

export const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const nowIso = () => new Date().toISOString();
export const isOpen = (t: Ticket) => t.status !== 'Clos' && t.status !== 'Rejeté';
export const unreadOf = (c: Conversation) => Math.max(0, c.messages.length - c.readCount);
export const priorityTone = (p: string) => (p === 'P1' ? 'red' : p === 'P2' ? 'amber' : p === 'P3' ? 'blue' : 'neutral');
export const statusTone = (s: string) => (s === 'Clos' ? 'green' : s === 'Résolu' ? 'green' : s === 'Rejeté' ? 'red' : s === 'En cours' || s === 'Pris en compte' ? 'blue' : s === 'En attente' ? 'amber' : 'neutral');

export function nextTicketId(kind: TicketKind, tickets: Ticket[]) {
  const max = tickets.reduce((m, t) => Math.max(m, Number(t.id.replace(/\D/g, '')) || 0), 2400);
  return `${PREFIX[kind]}-${max + 1}`;
}
export function nextKedbId(s: Store) {
  const max = s.kedb.reduce((m, a) => Math.max(m, Number(a.id.replace(/\D/g, '')) || 0), 100);
  return `KEDB-${String(max + 1).padStart(4, '0')}`;
}

export function messageTime(m: { time: string; at?: string }) { return m.at ? formatWAT(m.at, 'time') : m.time; }

/** Ajoute un événement au ticket et le reflète dans la discussion liée si elle existe. */
export function withTicketEvent(s: Store, id: string, body: string, patch: Partial<Ticket> = {}, author = s.profile.name, asComment = false): Store {
  const at = nowIso();
  const tickets = s.tickets.map(t => (t.id === id ? { ...t, ...patch, updates: [...t.updates, { author, body, time: formatWAT(at, 'datetime'), at }] } : t));
  const t = tickets.find(x => x.id === id);
  const conversations = t?.conversationId
    ? s.conversations.map(c => (c.id === t.conversationId ? { ...c, messages: [...c.messages, { id: uid(), author: asComment ? author : `Suivi ${id}`, body: asComment ? `Commentaire sur ${id} : ${body}` : body, time: '', at, system: !asComment, ticketId: id }] } : c))
    : s.conversations;
  return { ...s, tickets, conversations };
}

export function resolveTicket(s: Store, id: string, rootCause: string, resolution: string): Store {
  const ticket = s.tickets.find(t => t.id === id);
  if (!ticket || !['Pris en compte', 'En cours', 'En attente', 'Résolu'].includes(ticket.status)) {
    throw new Error('Le ticket doit être pris en charge avant sa résolution.');
  }
  if (ticket.kind === 'Changement' && ticket.cab?.decision !== 'Approuvé') {
    throw new Error('Une approbation CAB est nécessaire avant la résolution.');
  }
  if (rootCause.trim().length < 10 || resolution.trim().length < 10) {
    throw new Error('Documentez la cause racine et la solution (10 caractères minimum).');
  }
  return withTicketEvent(s, id, 'Résolution proposée. Cause racine et solution documentées ; en attente de confirmation du demandeur.', {
    status: 'Résolu', resolvedAt: ticket.resolvedAt ?? nowIso(),
    rootCause: rootCause.trim(), resolution: resolution.trim(),
  });
}

/** Requester agreement is simulated in the UI, not authenticated authorization. */
export function closeResolvedTicket(s: Store, id: string, satisfaction: number | null = null): Store {
  const ticket = s.tickets.find(t => t.id === id);
  if (ticket?.status === 'Clos') return s;
  if (!ticket || ticket.status !== 'Résolu' || !ticket.resolvedAt
    || (ticket.rootCause?.trim().length ?? 0) < 10 || (ticket.resolution?.trim().length ?? 0) < 10) {
    throw new Error('Une résolution documentée est nécessaire avant la confirmation.');
  }
  const existing = s.kedb.find(a => a.ticketId === id);
  const kedbId = existing?.id ?? nextKedbId(s);
  const at = nowIso();
  const next = withTicketEvent(s, id, `Confirmation du demandeur simulée${satisfaction ? ` · satisfaction ${satisfaction}/5` : ''}. Ticket clos ; article ${kedbId} disponible dans la base d’erreurs connues.`, {
    status: 'Clos', closedAt: at, kedbId, ...(satisfaction ? { satisfaction } : {}),
  });
  if (existing) return next;
  return {
    ...next,
    kedb: [{
      id: kedbId, title: ticket.title, symptom: ticket.description,
      rootCause: ticket.rootCause!, resolution: ticket.resolution!,
      ticketId: id, serviceId: ticket.serviceId ?? null, category: ticket.category,
      createdAt: at, author: s.profile.name,
    }, ...next.kedb],
  };
}

export function ticketSla(t: Ticket, now: number) {
  const d = getDeadlines(t.openedAt, t.priority);
  return {
    deadlines: d,
    ack: slaProgress(t.openedAt, d.acknowledgeBy, t.acknowledgedAt, now),
    res: slaProgress(t.openedAt, d.resolveBy, t.resolvedAt, now),
  };
}

export type KpiCount = { label: string; count: number };

const countBy = (tickets: Ticket[], key: (t: Ticket) => string): KpiCount[] => {
  const counts = new Map<string, number>();
  for (const t of tickets) {
    const label = key(t) || 'Non renseigné';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));
};

/**
 * ITIL indicators of the dashboard (CDC-ANIF-MSG-2025 §6.5): MTTR, MTBF, resolution SLA rate,
 * volume per category and per assignee, requester satisfaction. Rejected tickets are not support work and are left out.
 * Same continuous-time rules as ticketSla (no business hours).
 */
export function ticketKpis(tickets: Ticket[], now: number) {
  const counted = tickets.filter(t => t.status !== 'Rejeté');
  // Older closed tickets may carry only closedAt: it then marks the end of the resolution.
  const endOf = (t: Ticket) => t.resolvedAt ?? t.closedAt;
  const durations = counted.flatMap(t => {
    const end = endOf(t);
    const ms = end ? Date.parse(end) - Date.parse(t.openedAt) : Number.NaN;
    return Number.isFinite(ms) && ms >= 0 ? [ms] : [];
  });
  let met = 0, decided = 0;
  for (const t of counted) {
    const due = Date.parse(getDeadlines(t.openedAt, t.priority).resolveBy);
    const end = endOf(t);
    // An open ticket counts only once its deadline has passed; before that the outcome is unknown.
    if (end) { decided++; if (Date.parse(end) <= due) met++; } else if (now > due) decided++;
  }
  // MTBF (ITIL): per service, time from an incident's restoration to the next incident's opening.
  const uptimes: number[] = [];
  const incidentsByService = new Map<string, Ticket[]>();
  for (const t of counted) {
    if (t.kind !== 'Incident' || !t.serviceId) continue;
    incidentsByService.set(t.serviceId, [...(incidentsByService.get(t.serviceId) ?? []), t]);
  }
  for (const incidents of incidentsByService.values()) {
    incidents.sort((a, b) => Date.parse(a.openedAt) - Date.parse(b.openedAt));
    for (let i = 1; i < incidents.length; i++) {
      const restored = endOf(incidents[i - 1]!);
      // Overlapping incidents (the next one opened before restoration) add no uptime.
      const uptime = restored ? Date.parse(incidents[i]!.openedAt) - Date.parse(restored) : Number.NaN;
      if (Number.isFinite(uptime) && uptime >= 0) uptimes.push(uptime);
    }
  }
  const ratings = counted.map(t => t.satisfaction).filter((n): n is number => Number.isInteger(n) && n! >= 1 && n! <= 5);
  return {
    satisfactionAvg: ratings.length ? ratings.reduce((sum, n) => sum + n, 0) / ratings.length : null,
    satisfactionCount: ratings.length,
    mtbfMs: uptimes.length ? uptimes.reduce((sum, ms) => sum + ms, 0) / uptimes.length : null,
    mtbfIntervals: uptimes.length,
    total: counted.length,
    resolved: durations.length,
    mttrMs: durations.length ? durations.reduce((sum, ms) => sum + ms, 0) / durations.length : null,
    slaRate: decided ? met / decided : null,
    slaMet: met,
    slaDecided: decided,
    byCategory: countBy(counted, t => t.category),
    byAssignee: countBy(counted, t => t.assignee),
  };
}

/** ITIL indicators as a CSV report (§ 4.5): one row per figure, durations in minutes. */
export function ticketKpisToCsv(kpis: ReturnType<typeof ticketKpis>, generatedAt: string, label: (assignee: string) => string = x => x): string {
  const minutes = (ms: number | null) => (ms === null ? '' : Math.round(ms / 60_000));
  return toCsv(['indicateur', 'valeur', 'unite', 'detail'], [
    ['Rapport généré le', generatedAt, 'ISO 8601', ''],
    ['MTTR', minutes(kpis.mttrMs), 'minutes', `${kpis.resolved} résolu(s) sur ${kpis.total}`],
    ['MTBF', minutes(kpis.mtbfMs), 'minutes', `${kpis.mtbfIntervals} intervalle(s)`],
    ['Taux de respect du SLA de résolution', kpis.slaRate === null ? '' : Math.round(kpis.slaRate * 1000) / 10, '%', `${kpis.slaMet}/${kpis.slaDecided} dans le délai`],
    ['Satisfaction moyenne', kpis.satisfactionAvg === null ? '' : Math.round(kpis.satisfactionAvg * 10) / 10, 'sur 5', `${kpis.satisfactionCount} note(s)`],
    ...kpis.byCategory.map(row => [`Volume · catégorie ${row.label}`, row.count, 'tickets', '']),
    ...kpis.byAssignee.map(row => [`Volume · technicien ${label(row.label)}`, row.count, 'tickets', '']),
  ]);
}

/**
 * Preformatted requests (CDC-ANIF-MSG-2025 §6.5). Only autoApproved ones skip manual acknowledgement;
 * the server keeps the same list (AUTO_APPROVED_REQUESTS in itsm-workspace.ts).
 */
export const REQUEST_TEMPLATES: Array<{ id: string; label: string; autoApproved: boolean; draft: { title: string; category: string; impact: 1 | 2 | 3; urgency: 1 | 2 | 3; description: string } }> = [
  { id: 'mot-de-passe', label: 'Réinitialisation de mot de passe', autoApproved: true,
    draft: { title: 'Réinitialisation de mot de passe', category: 'Accès', impact: 3, urgency: 2, description: 'Compte concerné : \nMoyen de remise du mot de passe provisoire : ' } },
  { id: 'compte', label: 'Création de compte', autoApproved: false,
    draft: { title: 'Création de compte utilisateur', category: 'Accès', impact: 3, urgency: 3, description: 'Nom et prénom : \nDirection ou service : \nDate d’arrivée : \nAccès nécessaires : ' } },
  { id: 'logiciel', label: 'Installation de logiciel', autoApproved: false,
    draft: { title: 'Installation de logiciel', category: 'Poste de travail', impact: 3, urgency: 3, description: 'Logiciel et version : \nPoste (n° d’inventaire) : \nJustification : ' } },
];

export const RECURRENCE_WINDOW_DAYS = 7;
export const RECURRENCE_THRESHOLD = 3;
export type Recurrence = { serviceId: string; category: string; incidentIds: string[] };

/**
 * Recurring incidents (CDC-ANIF-MSG-2025 §6.3): at least RECURRENCE_THRESHOLD incidents on the same
 * service and category opened in the last RECURRENCE_WINDOW_DAYS days, not yet attached to a problem.
 */
export function recurringIncidents(tickets: Ticket[], now: number): Recurrence[] {
  const since = now - RECURRENCE_WINDOW_DAYS * 86_400_000;
  const attached = new Set(tickets.filter(t => t.kind === 'Problème' && t.status !== 'Rejeté').flatMap(t => t.incidentIds ?? []));
  const groups = new Map<string, Recurrence>();
  for (const t of tickets) {
    if (t.kind !== 'Incident' || t.status === 'Rejeté' || !t.serviceId || attached.has(t.id) || !(Date.parse(t.openedAt) >= since)) continue;
    const key = `${t.serviceId}|${t.category}`;
    const group = groups.get(key) ?? { serviceId: t.serviceId, category: t.category, incidentIds: [] };
    group.incidentIds.push(t.id);
    groups.set(key, group);
  }
  return [...groups.values()].filter(g => g.incidentIds.length >= RECURRENCE_THRESHOLD)
    .map(g => ({ ...g, incidentIds: [...g.incidentIds].sort() }))
    .sort((a, b) => b.incidentIds.length - a.incidentIds.length || a.serviceId.localeCompare(b.serviceId));
}

export const fmtMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}` : `${m} min`);

export function fmtDuration(ms: number) {
  const a = Math.abs(ms); const h = Math.floor(a / 3_600_000); const m = Math.floor((a % 3_600_000) / 60_000); const s = Math.floor((a % 60_000) / 1000);
  if (h >= 24) return `${Math.floor(h / 24)} j ${h % 24} h`;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  return `${m} min ${String(s).padStart(2, '0')} s`;
}

export type DerivedNotification = { id: string; ticketId: string; title: string; body: string; tone: 'amber' | 'red' | 'blue'; at: string; read: boolean };

export function deriveNotifications(s: Store, now: number): DerivedNotification[] {
  const list: DerivedNotification[] = [];
  for (const t of s.tickets) {
    if (!isOpen(t) || t.status === 'Résolu') continue;
    const { ack, res, deadlines } = ticketSla(t, now);
    if (!t.acknowledgedAt && (ack.state === 'warning' || ack.state === 'breach'))
      list.push({ id: `${t.id}:ack:${ack.state}`, ticketId: t.id, title: ack.state === 'breach' ? `Prise en charge dépassée · ${t.id}` : `Prise en charge bientôt due · ${t.id}`, body: `${t.priority} · échéance ${formatWAT(deadlines.acknowledgeBy, 'datetime')}`, tone: ack.state === 'breach' ? 'red' : 'amber', at: deadlines.acknowledgeBy, read: false });
    if (!t.resolvedAt && (res.state === 'warning' || res.state === 'breach'))
      list.push({ id: `${t.id}:res:${res.state}`, ticketId: t.id, title: res.state === 'breach' ? `Résolution dépassée · ${t.id}` : `Résolution bientôt due · ${t.id}`, body: `${t.priority} · échéance ${formatWAT(deadlines.resolveBy, 'datetime')}`, tone: res.state === 'breach' ? 'red' : 'amber', at: deadlines.resolveBy, read: false });
  }
  for (const n of s.notifications) list.push({ ...n, tone: 'blue', read: false });
  return list.map(n => ({ ...n, read: s.notifRead.includes(n.id) })).sort((a, b) => Number(a.read) - Number(b.read) || b.at.localeCompare(a.at));
}
