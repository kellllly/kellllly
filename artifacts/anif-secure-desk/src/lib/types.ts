import type { Priority } from './itsm';

export type Level = 1 | 2 | 3;
export type TicketKind = 'Incident' | 'Demande' | 'Problème' | 'Changement';
export type TicketStatus = 'Nouveau' | 'Pris en compte' | 'En cours' | 'En attente' | 'Résolu' | 'Clos' | 'Rejeté';
export type RoleKey = 'Direction' | 'Analyste' | 'SSI / support' | 'Services d’appui' | 'Auditeur temporaire';

export type DemoProfile = { name: string; role: string; clearance: string };
export type Message = {
  id: string; author: string; body: string; time: string; at?: string;
  system?: boolean; ticketId?: string;
  /** False marks a support report; true prevents conversion into an incident. */
  isInstruction?: boolean;
};
export type Conversation = {
  id: string; title: string; kind: string; classification: string; participants: string[];
  /** Nombre de messages déjà lus (les non lus sont dérivés : messages.length - readCount). */
  readCount: number; messages: Message[];
};
export type TicketUpdate = { author: string; body: string; time: string; at?: string };
export type CabDecision = { decision: 'Approuvé' | 'Rejeté'; by: string; at: string; reason: string };
export type Ticket = {
  id: string; title: string; kind: TicketKind; category: string;
  impact: Level; urgency: Level; priority: Priority; legacyPriority?: string;
  supportLevel: Level; status: TicketStatus; assignee: string; requester: string;
  serviceId?: string | null; assetId?: string | null;
  openedAt: string; acknowledgedAt: string | null; resolvedAt: string | null; closedAt: string | null;
  createdAt?: string; dueAt?: string; description: string;
  rootCause?: string; resolution?: string; cab?: CabDecision | null;
  conversationId?: string | null; sourceMessageId?: string | null; kedbId?: string | null;
  updates: TicketUpdate[];
};
export type Service = { id: string; name: string; category: string; status: string; owner: string; sla: string; description: string };
export type Asset = { id: string; name: string; type: string; location: string; status: string; owner: string };
export type AuditEvent = {
  id: string; action: string; actor: string; scope: string; time: string; at?: string;
  type?: string; targetUserId?: string; previousRole?: string | null; nextRole?: string | null;
  previousServiceIds?: string[]; serviceIds?: string[];
  ticketId?: string; sourceMessageId?: string; conversationId?: string;
};
export type KedbArticle = {
  id: string; title: string; symptom: string; rootCause: string; resolution: string;
  ticketId: string; serviceId?: string | null; category: string; createdAt: string; author: string;
};
export type StoredNotification = { id: string; ticketId: string; title: string; body: string; at: string };

export type Store = {
  schema: 2;
  profile: DemoProfile; theme: string;
  conversations: Conversation[]; tickets: Ticket[]; services: Service[]; assets: Asset[]; audit: AuditEvent[];
  kedb: KedbArticle[]; drafts: Record<string, string>;
  notifications: StoredNotification[]; notifRead: string[]; seeded: string[];
};
