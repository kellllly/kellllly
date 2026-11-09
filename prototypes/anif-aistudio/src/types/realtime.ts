import { EncryptedMessage, AccreditationLevel } from './index';

export type RealtimeEventType =
  | 'INIT'
  | 'AGENT_JOIN'
  | 'SEND_MESSAGE'
  | 'NEW_MESSAGE'
  | 'NOTIFICATION'
  | 'PRESENCE_UPDATE'
  | 'PING'
  | 'PONG';

export interface ActiveAgentPresence {
  id: string;
  matricule: string;
  nom: string;
  roleNiveau: AccreditationLevel;
  canalId?: string;
  joinedAt: string;
}

export interface WsInitPayload {
  messages: Record<string, EncryptedMessage[]>;
  connectedClients: number;
  activeAgents: ActiveAgentPresence[];
  serverTimeRFC: string;
}

export interface WsSendMessagePayload {
  message: EncryptedMessage;
}

export interface WsNewMessagePayload {
  message: EncryptedMessage;
  isBroadcast: boolean;
}

export interface WsNotificationPayload {
  id: string;
  type: 'MESSAGE' | 'SECURITY' | 'DISPATCH';
  title: string;
  body: string;
  canalId: string;
  senderMatricule: string;
  timestamp: string;
}

export interface WsPresencePayload {
  connectedClients: number;
  activeAgents: ActiveAgentPresence[];
}

export interface WsEnvelope<T = unknown> {
  type: RealtimeEventType;
  payload: T;
  timestamp?: number;
}
