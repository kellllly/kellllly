import type { Conversation } from './types';

/**
 * Accreditation shown with the gold padlock on channels with restricted access
 * (cahier des charges, indicateurs visuels). The pilot does not encrypt end to
 * end: the badge states who may enter, not a cryptographic guarantee.
 */
export function channelAccreditation(kind: string): string | null {
  if (kind === 'Enquête') return 'Accréditation N1 · N2 invités';
  if (kind === 'Direct') return 'Bilatéral · 2 agents';
  if (kind === 'Temporaire') return 'Membres invités · durée limitée';
  return null;
}

/** The other agent of a bilateral channel, seen from `me`. */
export function directPeer(conversation: Pick<Conversation, 'kind' | 'memberIds' | 'participants'>, me: string): string | null {
  if (conversation.kind !== 'Direct') return null;
  const members = conversation.memberIds?.length ? conversation.memberIds : conversation.participants;
  return members.find(member => member !== me) ?? null;
}
