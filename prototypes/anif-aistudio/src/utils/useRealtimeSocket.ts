import { useState, useEffect, useRef, useCallback } from 'react';
import { UserProfile, Channel, EncryptedMessage } from '../types';
import {
  RealtimeEventType,
  WsEnvelope,
  ActiveAgentPresence,
  WsInitPayload,
  WsPresencePayload,
  WsNewMessagePayload,
  WsNotificationPayload
} from '../types/realtime';
import {
  createWsEnvelope,
  parseWsMessage,
  applyIncomingMessage
} from './realtimeLogic';
import { INITIAL_MESSAGES } from '../data/initialData';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

export interface UseRealtimeSocketOptions {
  currentUser: UserProfile;
  activeChannel: Channel;
  onIncomingNotification?: (notif: WsNotificationPayload) => void;
  onRemoteMessageReceived?: (message: EncryptedMessage) => void;
}

export function useRealtimeSocket({
  currentUser,
  activeChannel,
  onIncomingNotification,
  onRemoteMessageReceived
}: UseRealtimeSocketOptions) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [latencyMs, setLatencyMs] = useState<number>(5.2);
  const [onlineAgentsCount, setOnlineAgentsCount] = useState<number>(1);
  const [onlineAgents, setOnlineAgents] = useState<ActiveAgentPresence[]>([]);
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, EncryptedMessage[]>>(INITIAL_MESSAGES);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pingStartTimeRef = useRef<number>(0);
  const isManuallyClosedRef = useRef<boolean>(false);

  // Keep latest callbacks in refs to avoid reconnection churning
  const onIncomingNotificationRef = useRef(onIncomingNotification);
  onIncomingNotificationRef.current = onIncomingNotification;

  const onRemoteMessageReceivedRef = useRef(onRemoteMessageReceived);
  onRemoteMessageReceivedRef.current = onRemoteMessageReceived;

  // Connect to the WebSocket server
  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;

    // Clean up existing socket if any
    if (socketRef.current) {
      try {
        socketRef.current.close();
      } catch {
        // ignore
      }
      socketRef.current = null;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    setConnectionStatus('connecting');

    try {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setConnectionStatus('connected');

        // Immediately inform the server about the current agent profile and active channel
        const joinPayload = {
          matricule: currentUser.matricule,
          nom: currentUser.nom,
          roleNiveau: currentUser.roleNiveau,
          canalId: activeChannel.id
        };
        ws.send(createWsEnvelope('AGENT_JOIN', joinPayload));

        // Start heartbeat ping
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            pingStartTimeRef.current = Date.now();
            ws.send(createWsEnvelope('PING', { t: pingStartTimeRef.current }));
          }
        }, 10000);
      };

      ws.onmessage = (event) => {
        const envelope = parseWsMessage(event.data);
        if (!envelope) return;

        switch (envelope.type) {
          case 'INIT': {
            const payload = envelope.payload as WsInitPayload;
            if (payload.messages) {
              setMessagesByChannel(payload.messages);
            }
            if (typeof payload.connectedClients === 'number') {
              setOnlineAgentsCount(payload.connectedClients);
            }
            if (Array.isArray(payload.activeAgents)) {
              setOnlineAgents(payload.activeAgents);
            }
            break;
          }

          case 'NEW_MESSAGE': {
            const payload = envelope.payload as WsNewMessagePayload;
            const newMsg = payload.message;
            if (newMsg) {
              setMessagesByChannel((prev) => {
                const { updated, isDuplicate } = applyIncomingMessage(prev, newMsg);
                if (!isDuplicate && onRemoteMessageReceivedRef.current) {
                  onRemoteMessageReceivedRef.current(newMsg);
                }
                return updated;
              });
            }
            break;
          }

          case 'NOTIFICATION': {
            const payload = envelope.payload as WsNotificationPayload;
            if (payload && onIncomingNotificationRef.current) {
              onIncomingNotificationRef.current(payload);
            }
            break;
          }

          case 'PRESENCE_UPDATE': {
            const payload = envelope.payload as WsPresencePayload;
            if (typeof payload.connectedClients === 'number') {
              setOnlineAgentsCount(payload.connectedClients);
            }
            if (Array.isArray(payload.activeAgents)) {
              setOnlineAgents(payload.activeAgents);
            }
            break;
          }

          case 'PONG': {
            if (pingStartTimeRef.current > 0) {
              const rtt = Math.max(1, Date.now() - pingStartTimeRef.current);
              setLatencyMs(rtt);
            }
            break;
          }

          default:
            break;
        }
      };

      ws.onerror = (err) => {
        console.warn('[Realtime WS] Erreur socket:', err);
      };

      ws.onclose = () => {
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);

        if (!isManuallyClosedRef.current) {
          setConnectionStatus('reconnecting');
          // Schedule auto-reconnect
          if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 2500);
        } else {
          setConnectionStatus('disconnected');
        }
      };
    } catch (err) {
      console.warn('[Realtime WS] Impossible d\'établir la connexion:', err);
      setConnectionStatus('disconnected');
    }
  }, [currentUser.matricule, currentUser.nom, currentUser.roleNiveau, activeChannel.id]);

  // Update presence when user or activeChannel changes
  useEffect(() => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const joinPayload = {
        matricule: currentUser.matricule,
        nom: currentUser.nom,
        roleNiveau: currentUser.roleNiveau,
        canalId: activeChannel.id
      };
      socketRef.current.send(createWsEnvelope('AGENT_JOIN', joinPayload));
    }
  }, [currentUser, activeChannel.id]);

  // Initial connection
  useEffect(() => {
    isManuallyClosedRef.current = false;
    connect();

    return () => {
      isManuallyClosedRef.current = true;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [connect]);

  // Send message through WebSocket
  const sendRealtimeMessage = useCallback((message: EncryptedMessage): boolean => {
    // 1. Optimistic local update
    setMessagesByChannel((prev) => {
      const { updated } = applyIncomingMessage(prev, message);
      return updated;
    });

    // 2. Dispatch via WebSocket to server
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(createWsEnvelope('SEND_MESSAGE', { message }));
        return true;
      } catch (err) {
        console.error('[Realtime WS] Erreur lors de la transmission socket:', err);
      }
    }

    // 3. REST API Fallback if socket is not open
    fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    }).catch((err) => {
      console.warn('[Realtime WS] Échec fallback HTTP:', err);
    });

    return false;
  }, []);

  return {
    connectionStatus,
    latencyMs,
    onlineAgentsCount,
    onlineAgents,
    messagesByChannel,
    setMessagesByChannel,
    sendRealtimeMessage,
    reconnect: connect
  };
}
