import type { Conversation } from './types';

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('fr-FR');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/** `@name` as a whole token: not inside an e-mail address, not followed by more letters. */
const tokenPattern = (name: string) => `(?<![\\p{L}\\p{N}_.])@${escape(fold(name.trim()))}(?![\\p{L}\\p{N}_])`;

/** 'me' when one of my names is mentioned, 'all' for @tous; case and accents are ignored. */
export function mentionOf(body: string, myNames: readonly string[]): 'me' | 'all' | null {
  const text = fold(body);
  if (myNames.some(name => name.trim() && new RegExp(tokenPattern(name), 'u').test(text))) return 'me';
  return new RegExp(tokenPattern('tous'), 'u').test(text) ? 'all' : null;
}

export type MentionNotification = { id: string; conversationId: string; messageId: string; title: string; body: string; at: string };

/** One notification per live message from someone else that mentions me or everyone. */
export function mentionNotifications(conversations: readonly Conversation[], me: string, myNames: readonly string[]): MentionNotification[] {
  return conversations.flatMap(c => c.messages.flatMap(m => {
    if (m.author === me || m.system || m.deleted || m.expired || !m.at) return [];
    const kind = mentionOf(m.body, myNames);
    if (!kind) return [];
    const excerpt = m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body;
    return [{ id: `mention:${m.id}`, conversationId: c.id, messageId: m.id, title: kind === 'all' ? `Message à tous · ${c.title}` : `Vous êtes mentionné · ${c.title}`, body: excerpt, at: m.at }];
  }));
}

/** Splits a message body so the mentions of known names (and @tous) can be highlighted. */
export function splitMentions(body: string, names: readonly string[]): { text: string; mention: boolean }[] {
  const known = [...new Set(['tous', ...names.map(n => n.trim()).filter(Boolean)])].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_.])@(?:${known.map(escape).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  const parts: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    if (match.index > last) parts.push({ text: body.slice(last, match.index), mention: false });
    parts.push({ text: match[0], mention: true });
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), mention: false });
  return parts;
}
