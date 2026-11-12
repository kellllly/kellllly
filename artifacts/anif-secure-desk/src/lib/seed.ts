import { priorityFor } from './itsm';
import { parsePresence } from './presence';
import type { Conversation, Level, Store, Ticket, TicketKind, TicketStatus } from './types';

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Convertit les anciens libellés relatifs (« Aujourd’hui, 08:17 », « Hier, 15:40 ») en ISO approximatif. */
export function parseLegacyTime(label: string | undefined, fallbackMinutesAgo = 60): string {
  const now = Date.now();
  if (!label) return iso(now - fallbackMinutesAgo * MIN);
  if (/instant/i.test(label)) return iso(now);
  const m = label.match(/(\d{1,2})[:h](\d{2})/);
  // Libreville is UTC+1 year-round; don't interpret legacy labels in the host's zone.
  const d = new Date(now + 60 * MIN);
  if (/hier/i.test(label)) d.setUTCDate(d.getUTCDate() - 1);
  else if (/demain/i.test(label)) d.setUTCDate(d.getUTCDate() + 1);
  if (m) d.setUTCHours(Number(m[1]), Number(m[2]), 0, 0);
  else if (!/hier|demain|aujourd/i.test(label)) return iso(now - fallbackMinutesAgo * MIN);
  let result = d.getTime() - 60 * MIN;
  if (/aujourd/i.test(label) && result > now) result -= 24 * 60 * MIN;
  return iso(result);
}

const LEGACY_PRIORITY: Record<string, [Level, Level]> = { Critique: [1, 1], 'Élevée': [1, 2], Normale: [2, 2], Faible: [3, 3] };
const STATUSES: TicketStatus[] = ['Nouveau', 'Pris en compte', 'En cours', 'En attente', 'Résolu', 'Clos', 'Rejeté'];
const lvl = (v: unknown, d: Level): Level => (v === 1 || v === 2 || v === 3 ? v : d);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeTicket(t: any): Ticket {
  const legacy = LEGACY_PRIORITY[t.priority as string];
  const impact = lvl(t.impact, legacy?.[0] ?? 2);
  const urgency = lvl(t.urgency, legacy?.[1] ?? 2);
  const id = String(t.id);
  const kind: TicketKind = ['Incident', 'Demande', 'Problème', 'Changement'].includes(t.kind) ? t.kind
    : id.startsWith('REQ') ? 'Demande' : id.startsWith('PRB') ? 'Problème' : id.startsWith('CHG') ? 'Changement' : 'Incident';
  const status: TicketStatus = STATUSES.includes(t.status) ? t.status : 'Nouveau';
  const openedAt: string = t.openedAt ?? parseLegacyTime(t.createdAt, 90);
  const opened = new Date(openedAt).getTime();
  const acknowledgedAt = t.acknowledgedAt !== undefined ? t.acknowledgedAt : status === 'Nouveau' ? null : iso(Math.min(Date.now(), opened + 7 * MIN));
  const lastUpdate = Array.isArray(t.updates) && t.updates.length ? t.updates[t.updates.length - 1] : null;
  const resolvedAt = t.resolvedAt !== undefined ? t.resolvedAt
    : status === 'Résolu' || status === 'Clos' ? (lastUpdate?.at ?? parseLegacyTime(lastUpdate?.time, 30)) : null;
  return {
    id, title: String(t.title ?? 'Ticket sans titre'), kind, category: t.category ?? 'Applications',
    impact, urgency, priority: priorityFor(impact, urgency),
    legacyPriority: t.legacyPriority ?? (legacy ? t.priority : undefined),
    supportLevel: lvl(t.supportLevel, 1), status, assignee: t.assignee ?? 'Équipe support', requester: t.requester ?? '—',
    serviceId: t.serviceId ?? null, assetId: t.assetId ?? null,
    openedAt, acknowledgedAt, resolvedAt, closedAt: t.closedAt ?? null,
    createdAt: t.createdAt, dueAt: t.dueAt, description: t.description ?? '',
    rootCause: t.rootCause, resolution: t.resolution, cab: t.cab ?? null,
    conversationId: t.conversationId ?? null, sourceMessageId: t.sourceMessageId ?? null, kedbId: t.kedbId ?? null,
    // Only when rated: the server compares closed tickets exactly and stores no `null` here.
    ...(t.satisfaction != null ? { satisfaction: t.satisfaction } : {}),
    ...(Array.isArray(t.incidentIds) ? { incidentIds: t.incidentIds } : {}),
    ...(typeof t.template === 'string' ? { template: t.template } : {}),
    updates: Array.isArray(t.updates) ? t.updates : [],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeConversation(c: any): Conversation {
  const messages = Array.isArray(c.messages) ? c.messages : [];
  const readCount = typeof c.readCount === 'number' ? c.readCount : Math.max(0, messages.length - (Number(c.unread) || 0));
  return { id: c.id, title: c.title, kind: c.kind ?? 'Groupe', classification: c.classification ?? 'Interne', participants: c.participants ?? [], readCount, messages, ...(Array.isArray(c.memberIds) ? { memberIds: c.memberIds } : {}), ...(typeof c.expiresAt === 'string' ? { expiresAt: c.expiresAt } : {}), ...(Array.isArray(c.pinnedIds) && c.pinnedIds.length ? { pinnedIds: c.pinnedIds } : {}), ...(c.readBy && typeof c.readBy === 'object' && !Array.isArray(c.readBy) ? { readBy: Object.fromEntries(Object.entries(c.readBy).filter(([, at]) => typeof at === 'string')) as Record<string, string> } : {}) };
}

const LEGACY_CONVERSATIONS = [
  { id: 'C-204', title: 'Point de coordination — cellule conformité', kind: 'Groupe', classification: 'Interne', participants: ['Nadia Moussavou', 'Paul Nziengui', 'Mireille Ondo'], unread: 2, messages: [
    { id: 'm1', author: 'Paul Nziengui', body: 'La synthèse de la réunion de ce matin est disponible dans l’espace de travail partagé.', time: '09:42' },
    { id: 'm2', author: 'Mireille Ondo', body: 'Bien reçu. Je propose un point de 15 minutes à 14 h pour valider les prochaines étapes.', time: '09:48' },
    { id: 'm3', author: 'Nadia Moussavou', body: 'Parfait, je bloque le créneau et prépare l’ordre du jour.', time: '09:53' },
  ] },
  { id: 'C-198', title: 'Continuité — outils collaboratifs', kind: 'Équipe', classification: 'Interne', participants: ['Nadia Moussavou', 'Équipe support'], unread: 0, messages: [
    { id: 'm4', author: 'Olivier Nguema', body: 'Le contrôle de disponibilité est terminé. Les services sont stables depuis 08:15.', time: '08:26' },
    { id: 'm5', author: 'Nadia Moussavou', body: 'Merci pour le suivi. Je reste disponible si un nouvel indicateur apparaît.', time: '08:31' },
  ] },
  { id: 'C-190', title: 'Comité de pilotage — semaine 24', kind: 'Comité', classification: 'Restreint', participants: ['Nadia Moussavou', 'Direction', 'SSI'], unread: 0, messages: [
    { id: 'm6', author: 'Aline Ekomie', body: 'Le support de pilotage a été mis à jour avec les indicateurs de service.', time: 'Hier' },
  ] },
  { id: 'C-184', title: 'Accueil des nouveaux collaborateurs', kind: 'Groupe', classification: 'Interne', participants: ['Nadia Moussavou', 'RH', 'Support'], unread: 0, messages: [
    { id: 'm7', author: 'Élodie Mba', body: 'Les postes du prochain groupe sont prêts pour la remise de lundi.', time: 'Hier' },
  ] },
];

const LEGACY_TICKETS = [
  { id: 'INC-2418', title: 'Accès intermittent au portail de services', category: 'Applications', priority: 'Élevée', status: 'En cours', assignee: 'Olivier Nguema', requester: 'Aline Ekomie', createdAt: 'Aujourd’hui, 08:17', dueAt: 'Aujourd’hui, 12:00', serviceId: 'SVC-02', description: 'Plusieurs collaborateurs signalent des interruptions brèves lors de l’ouverture du portail de services. Aucun contenu métier n’est requis pour le diagnostic.', updates: [{ author: 'Olivier Nguema', body: 'Vérification des journaux de disponibilité et des connexions réseau en cours.', time: '09:12' }] },
  { id: 'REQ-2416', title: 'Préparer un poste pour une arrivée', category: 'Poste de travail', priority: 'Normale', status: 'Nouveau', assignee: 'Équipe support', requester: 'Élodie Mba', createdAt: 'Aujourd’hui, 08:02', dueAt: 'Demain, 16:00', assetId: 'MAT-0874', description: 'Préparation standard d’un poste et des accès aux outils de collaboration pour une arrivée planifiée.', updates: [] },
  { id: 'INC-2411', title: 'Synchronisation des calendriers', category: 'Applications', priority: 'Normale', status: 'En attente', assignee: 'Jean-Pierre Obame', requester: 'Paul Nziengui', createdAt: 'Hier, 15:40', dueAt: 'Demain, 12:00', description: 'Un groupe de collaborateurs observe un délai de synchronisation des calendriers sur les appareils mobiles.', updates: [{ author: 'Jean-Pierre Obame', body: 'En attente d’un créneau pour effectuer une vérification guidée.', time: 'Hier, 16:10' }] },
  { id: 'INC-2406', title: 'Remplacement d’un équipement de salle', category: 'Équipement', priority: 'Faible', status: 'Résolu', assignee: 'Équipe support', requester: 'Mireille Ondo', createdAt: 'Hier, 10:28', dueAt: 'Hier, 17:00', description: 'Adaptateur de présentation remplacé dans la salle de réunion Est. Vérification fonctionnelle effectuée.', rootCause: 'Adaptateur de présentation défaillant identifié au diagnostic.', resolution: 'Adaptateur remplacé et affichage vérifié avec l’équipe.', updates: [{ author: 'Équipe support', body: 'Matériel remplacé et fonctionnement confirmé avec l’équipe.', time: 'Hier, 14:36' }] },
];

function supportChannel(now: number): Conversation {
  return {
    id: 'C-SUP', title: 'Canal support — continuité numérique', kind: 'Support', classification: 'Interne',
    participants: ['Nadia Moussavou', 'Équipe support N1', 'Olivier Nguema'], readCount: 1,
    messages: [
      { id: 'sup-1', author: 'Équipe support N1', body: 'Canal dédié aux signalements techniques. Décrivez uniquement le symptôme observé, le service et l’heure. Le support peut convertir un message en incident après relecture.', time: '', at: iso(now - 95 * MIN), isInstruction: true },
      { id: 'sup-2', author: 'Élodie Mba', body: 'Depuis 10 h, l’impression vers le copieur du 2e étage échoue avec une erreur de file d’attente. Aucun document n’est concerné, seulement l’outil.', time: '', at: iso(now - 42 * MIN), isInstruction: false },
      { id: 'sup-3', author: 'Paul Nziengui', body: 'Le client de visioconférence se ferme au lancement sur deux postes de la salle Ouest depuis la mise à jour de ce matin.', time: '', at: iso(now - 18 * MIN), isInstruction: false },
    ],
  };
}

function extraTickets(now: number): Ticket[] {
  return [
    normalizeTicket({ id: 'INC-2422', kind: 'Incident', title: 'Coupure du réseau des bureaux — bâtiment A, 1er étage', category: 'Réseau', impact: 1, urgency: 1, status: 'Nouveau', assignee: 'Équipe infrastructure', requester: 'Mireille Ondo', serviceId: 'SVC-03', assetId: 'MAT-0527', openedAt: iso(now - 11 * MIN), acknowledgedAt: null, resolvedAt: null, description: 'Aucun accès réseau filaire ni Wi-Fi pour une vingtaine de postes depuis la fin de matinée.', updates: [] }),
    normalizeTicket({ id: 'PRB-2402', kind: 'Problème', title: 'Coupures récurrentes du portail de services', category: 'Applications', impact: 2, urgency: 2, status: 'En cours', supportLevel: 3, assignee: 'Support applicatif', requester: 'Olivier Nguema', serviceId: 'SVC-02', openedAt: iso(now - 26 * 60 * MIN), acknowledgedAt: iso(now - 25.6 * 60 * MIN), resolvedAt: null, description: 'Analyse de cause racine des interruptions répétées observées sur trois incidents récents, dont INC-2418.', updates: [{ author: 'Support applicatif', body: 'Corrélation en cours entre les interruptions et le renouvellement des sessions.', time: '', at: iso(now - 20 * 60 * MIN) }] }),
    normalizeTicket({ id: 'CHG-2421', kind: 'Changement', title: 'Mise à jour du contrôleur Wi-Fi — aile Est', category: 'Réseau', impact: 2, urgency: 3, status: 'Nouveau', supportLevel: 2, assignee: 'Équipe infrastructure', requester: 'Jean-Pierre Obame', serviceId: 'SVC-03', assetId: 'MAT-0527', openedAt: iso(now - 70 * MIN), acknowledgedAt: null, resolvedAt: null, description: 'Application d’une version corrective du micrologiciel. Fenêtre proposée hors heures de bureau, retour arrière documenté.', updates: [] }),
  ];
}

export function baseStore(): Omit<Store, 'tickets' | 'conversations' | 'seeded'> {
  return {
    schema: 2,
    profile: { name: 'Nadia Moussavou', role: 'Analyste', clearance: 'N2 · Interne' },
    theme: 'light',
    services: [
      { id: 'SVC-01', name: 'Messagerie collaborative', category: 'Collaboration', status: 'Opérationnel', owner: 'Équipe numérique', sla: 'Support 8 h–17 h', description: 'Accès aux échanges professionnels et aux espaces de discussion d’équipe.' },
      { id: 'SVC-02', name: 'Portail de services', category: 'Applications', status: 'Vigilance', owner: 'Support applicatif', sla: 'Prise en charge < 4 h', description: 'Point d’entrée pour les demandes d’assistance et le suivi des services internes.' },
      { id: 'SVC-03', name: 'Réseau des bureaux', category: 'Infrastructure', status: 'Opérationnel', owner: 'Équipe infrastructure', sla: 'Supervision ouvrée', description: 'Connectivité des espaces de travail et accès aux outils internes.' },
      { id: 'SVC-04', name: 'Poste de travail standard', category: 'Équipement', status: 'Opérationnel', owner: 'Support de proximité', sla: 'Prise en charge < 1 j', description: 'Configuration et accompagnement des équipements de travail attribués.' },
    ],
    assets: [
      { id: 'MAT-0782', name: 'Ordinateur portable — série K', type: 'Poste de travail', location: 'Libreville · Direction', status: 'Attribué', owner: 'Nadia Moussavou' },
      { id: 'MAT-0641', name: 'Station d’accueil — série D', type: 'Périphérique', location: 'Libreville · Direction', status: 'Attribué', owner: 'Nadia Moussavou' },
      { id: 'MAT-0913', name: 'Écran 24″ — série V', type: 'Affichage', location: 'Libreville · Support', status: 'En stock', owner: 'Inventaire' },
      { id: 'MAT-0527', name: 'Point d’accès — aile Est', type: 'Réseau', location: 'Libreville · Bâtiment A', status: 'En service', owner: 'Équipe infrastructure' },
      { id: 'MAT-0874', name: 'Ordinateur portable — série K', type: 'Poste de travail', location: 'Libreville · Accueil', status: 'À préparer', owner: 'Équipe support' },
    ],
    audit: [
      { id: 'a1', action: 'Session de démonstration ouverte', actor: 'Nadia Moussavou', scope: 'Poste de pilotage', time: 'Aujourd’hui, 08:54' },
      { id: 'a2', action: 'Ticket INC-2418 consulté', actor: 'Nadia Moussavou', scope: 'Support informatique', time: 'Aujourd’hui, 09:06' },
      { id: 'a3', action: 'Service « Portail de services » consulté', actor: 'Nadia Moussavou', scope: 'Catalogue des services', time: 'Aujourd’hui, 09:11' },
    ],
    kedb: [], drafts: {}, notifications: [], notifRead: [],
  };
}

const ROLE_MAP: Record<string, string> = { 'Support IT': 'SSI / support', SSI: 'SSI / support' };
export const ROLES: { role: string; level: string; clearance: string; text: string }[] = [
  { role: 'Direction', level: 'N1', clearance: 'N1 · Pilotage', text: 'Arbitrage, approbation CAB, vue consolidée' },
  { role: 'Analyste', level: 'N2', clearance: 'N2 · Interne', text: 'Coordination, signalement, suivi' },
  { role: 'SSI / support', level: 'N3', clearance: 'N3 · Technique', text: 'Traitement, escalade, résolution' },
  { role: 'Services d’appui', level: 'N4', clearance: 'N4 · Périmètre', text: 'Interventions sur leur périmètre' },
  { role: 'Auditeur temporaire', level: 'N5', clearance: 'N5 · Lecture', text: 'Consultation et extraction du journal' },
];

/** Migration non destructive de anif-demo-v1 vers le schéma 2. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function migrate(raw: any): Store {
  const now = Date.now();
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = baseStore();
  const seeded: string[] = Array.isArray(src.seeded) ? [...src.seeded] : [];
  const tickets: Ticket[] = (Array.isArray(src.tickets) ? src.tickets : LEGACY_TICKETS).map(normalizeTicket);
  const conversations: Conversation[] = (Array.isArray(src.conversations) ? src.conversations : LEGACY_CONVERSATIONS).map(normalizeConversation);
  for (const conversation of conversations) {
    if (conversation.id === 'C-SUP') {
      conversation.messages = conversation.messages.map(message => message.id === 'sup-1' ? { ...message, isInstruction: true } : message);
    }
  }
  if (!seeded.includes('support-channel')) {
    if (!conversations.some(c => c.id === 'C-SUP')) conversations.unshift(supportChannel(now));
    seeded.push('support-channel');
  }
  if (!seeded.includes('itil-tickets')) {
    for (const t of extraTickets(now)) if (!tickets.some(x => x.id === t.id)) tickets.unshift(t);
    seeded.push('itil-tickets');
  }
  const profile = { ...base.profile, ...(src.profile ?? {}) };
  if (ROLE_MAP[profile.role]) profile.role = ROLE_MAP[profile.role];
  const role = ROLES.find(r => r.role === profile.role);
  if (role && !/^N\d/.test(profile.clearance)) profile.clearance = role.clearance;
  return {
    schema: 2, profile, theme: src.theme === 'dark' ? 'dark' : 'light',
    tickets, conversations,
    services: Array.isArray(src.services) ? src.services : base.services,
    assets: Array.isArray(src.assets) ? src.assets : base.assets,
    audit: Array.isArray(src.audit) ? src.audit : base.audit,
    kedb: Array.isArray(src.kedb) ? src.kedb : [],
    drafts: src.drafts && typeof src.drafts === 'object' ? src.drafts : {},
    notifications: Array.isArray(src.notifications) ? src.notifications : [],
    notifRead: Array.isArray(src.notifRead) ? src.notifRead : [],
    seeded,
    ...(src.presence ? { presence: parsePresence(src.presence) } : {}),
  };
}
