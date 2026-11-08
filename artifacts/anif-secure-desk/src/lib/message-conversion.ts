import { formatWAT, priorityFor } from './itsm';
import type { Level, Message, SupportMessageFilter, Ticket } from './types';

export function isConvertibleSupportMessage(message: Message): boolean {
  return !message.system && !message.isInstruction && !message.expired;
}

export function filterSupportMessages(messages: Message[], filter: SupportMessageFilter): Message[] {
  if (filter === 'all') return messages;
  const showInstructions = filter === 'instruction';
  return messages.filter(message => !message.system && Boolean(message.isInstruction) === showInstructions);
}

export function createIncidentFromMessage({
  message, conversationId, ticketId, title, summary, impact, urgency, serviceId, openedAt, actor,
}: {
  message: Message;
  conversationId: string;
  ticketId: string;
  title: string;
  summary: string;
  impact: Level;
  urgency: Level;
  serviceId: string;
  openedAt: string;
  actor: string;
}): Ticket {
  return {
    id: ticketId,
    title,
    kind: 'Incident',
    category: 'Applications',
    impact,
    urgency,
    priority: priorityFor(impact, urgency),
    supportLevel: 1,
    status: 'Nouveau',
    assignee: 'Équipe support',
    requester: message.author,
    serviceId: serviceId || null,
    assetId: null,
    openedAt,
    acknowledgedAt: null,
    resolvedAt: null,
    closedAt: null,
    description: summary,
    cab: null,
    conversationId,
    sourceMessageId: message.id,
    updates: [{
      author: actor,
      body: `Incident créé depuis le canal support (message ${message.id}) après relecture du résumé technique.`,
      time: formatWAT(openedAt, 'datetime'),
      at: openedAt,
    }],
  };
}
