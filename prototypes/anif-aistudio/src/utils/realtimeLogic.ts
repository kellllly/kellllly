import { EncryptedMessage } from '../types';
import {
  RealtimeEventType,
  WsEnvelope,
  WsNotificationPayload,
  WsNewMessagePayload,
  WsInitPayload
} from '../types/realtime';

/**
 * Encode an event into a JSON WebSocket envelope.
 */
export function createWsEnvelope<T>(type: RealtimeEventType, payload: T): string {
  const envelope: WsEnvelope<T> = {
    type,
    payload,
    timestamp: Date.now()
  };
  return JSON.stringify(envelope);
}

/**
 * Safely parse a raw WebSocket message string.
 */
export function parseWsMessage(raw: string): WsEnvelope | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      return null;
    }
    return parsed as WsEnvelope;
  } catch {
    return null;
  }
}

/**
 * Idempotently appends an incoming message to a channel's message list.
 * Guards against duplicate messages from reconnection races or re-broadcasts.
 */
export function applyIncomingMessage(
  prevMessages: Record<string, EncryptedMessage[]>,
  newMessage: EncryptedMessage
): { updated: Record<string, EncryptedMessage[]>; isDuplicate: boolean } {
  const canalId = newMessage.canalId;
  const currentList = prevMessages[canalId] || [];

  // Idempotency check: verify whether this message ID is already registered
  const exists = currentList.some((m) => m.id === newMessage.id);
  if (exists) {
    return { updated: prevMessages, isDuplicate: true };
  }

  return {
    updated: {
      ...prevMessages,
      [canalId]: [...currentList, newMessage]
    },
    isDuplicate: false
  };
}

/**
 * Build a server-side pushed notification descriptor from an encrypted message.
 */
export function buildNotificationFromMessage(
  message: EncryptedMessage,
  channelCode: string
): WsNotificationPayload {
  return {
    id: `NOTIF-${message.id}-${Date.now()}`,
    type: 'MESSAGE',
    title: `Nouveau Message E2EE (#${channelCode})`,
    body: `${message.auteur} a transmis un payload chiffré dans l'enclave Nkok.`,
    canalId: message.canalId,
    senderMatricule: message.matricule,
    timestamp: message.timestampRFC3161 || new Date().toISOString()
  };
}

/**
 * Validates a message payload structure received over WebSocket.
 */
/** Limites appliquées aux messages reçus du réseau (anti-saturation mémoire). */
export const MESSAGE_LIMITS = {
  idMaxLength: 128,
  canalIdMaxLength: 64,
  auteurMaxLength: 120,
  matriculeMaxLength: 64,
  texteMaxLength: 8000,
  chiffreHexMaxLength: 40000
} as const;

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function boundedString(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string' && (allowEmpty || value.length > 0) && value.length <= max;
}

/**
 * Validates a message payload structure received over WebSocket or REST.
 * When `allowedChannelIds` is given, the channel must belong to that list.
 */
export function validateIncomingMessage(
  msg: unknown,
  allowedChannelIds?: ReadonlySet<string>
): msg is EncryptedMessage {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return false;
  const m = msg as Record<string, unknown>;
  const valid =
    boundedString(m.id, MESSAGE_LIMITS.idMaxLength) &&
    boundedString(m.canalId, MESSAGE_LIMITS.canalIdMaxLength) &&
    !FORBIDDEN_KEYS.has(m.canalId) &&
    boundedString(m.auteur, MESSAGE_LIMITS.auteurMaxLength, true) &&
    boundedString(m.matricule, MESSAGE_LIMITS.matriculeMaxLength, true) &&
    boundedString(m.texteClair, MESSAGE_LIMITS.texteMaxLength, true) &&
    boundedString(m.chiffreHex, MESSAGE_LIMITS.chiffreHexMaxLength, true);
  if (!valid) return false;
  if (allowedChannelIds && !allowedChannelIds.has(m.canalId as string)) return false;
  return true;
}

/**
 * Appends a message while keeping at most `maxPerChannel` messages per channel
 * (the oldest are dropped first).
 */
export function appendWithCap(
  store: Record<string, EncryptedMessage[]>,
  message: EncryptedMessage,
  maxPerChannel: number
): { updated: Record<string, EncryptedMessage[]>; isDuplicate: boolean } {
  const result = applyIncomingMessage(store, message);
  if (result.isDuplicate) return result;
  const list = result.updated[message.canalId];
  if (list.length > maxPerChannel) {
    result.updated[message.canalId] = list.slice(list.length - maxPerChannel);
  }
  return result;
}
