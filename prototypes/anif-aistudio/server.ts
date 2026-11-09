import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { INITIAL_MESSAGES, CHANNELS } from './src/data/initialData.js';
import { EncryptedMessage, AccreditationLevel } from './src/types/index.js';
import {
  RealtimeEventType,
  WsEnvelope,
  ActiveAgentPresence,
  WsInitPayload,
  WsPresencePayload,
  WsNewMessagePayload,
  WsNotificationPayload
} from './src/types/realtime.js';
import {
  createWsEnvelope,
  parseWsMessage,
  applyIncomingMessage,
  buildNotificationFromMessage,
  validateIncomingMessage,
  appendWithCap
} from './src/utils/realtimeLogic.js';
import { TokenBucketRateLimiter } from './src/utils/rateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

// Express Application Setup
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

// Limites anti-saturation (prototype en mémoire)
const MAX_MESSAGES_PER_CHANNEL = 500;
const WS_MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_WS_CLIENTS = 200;
const ALLOWED_CHANNEL_IDS: ReadonlySet<string> = new Set(CHANNELS.map((c) => c.id));
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key !== 'MY_GEMINI_API_KEY');
}

// Limiteur par adresse IP pour les routes REST d'écriture et d'IA
const restLimiters = new Map<string, TokenBucketRateLimiter>();
function restRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'inconnu';
  let limiter = restLimiters.get(ip);
  if (!limiter) {
    if (restLimiters.size > 5000) restLimiters.clear();
    limiter = new TokenBucketRateLimiter(10, 1);
    restLimiters.set(ip, limiter);
  }
  if (!limiter.consume().allowed) {
    res.status(429).json({ error: 'Trop de requêtes, réessayez dans quelques secondes.' });
    return;
  }
  next();
}

// Server-authoritative in-memory state
// Cloned from INITIAL_MESSAGES to ensure mutations persist during runtime
const messagesStore: Record<string, EncryptedMessage[]> = JSON.parse(JSON.stringify(INITIAL_MESSAGES));

// Connected WebSocket clients registry
interface ConnectedClient {
  id: string;
  ws: WebSocket;
  matricule?: string;
  nom?: string;
  roleNiveau?: AccreditationLevel;
  canalId?: string;
  joinedAt: string;
}

const clientsMap = new Map<string, ConnectedClient>();

// Helper to compile current online agents
function getActiveAgents(): ActiveAgentPresence[] {
  const result: ActiveAgentPresence[] = [];
  const seenMatricules = new Set<string>();

  for (const client of clientsMap.values()) {
    if (client.matricule && !seenMatricules.has(client.matricule)) {
      seenMatricules.add(client.matricule);
      result.push({
        id: client.id,
        matricule: client.matricule,
        nom: client.nom || 'Agent ANIF',
        roleNiveau: client.roleNiveau || 2,
        canalId: client.canalId,
        joinedAt: client.joinedAt
      });
    }
  }

  return result;
}

// Broadcast an envelope to all connected WebSocket clients
function broadcast(envelopeJson: string, exceptClientId?: string) {
  for (const [clientId, client] of clientsMap.entries()) {
    if (exceptClientId && clientId === exceptClientId) continue;
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(envelopeJson);
      } catch (err) {
        console.error(`Erreur d'envoi WS client ${clientId}:`, err);
      }
    }
  }
}

// Broadcast updated presence
function broadcastPresence() {
  const presencePayload: WsPresencePayload = {
    connectedClients: clientsMap.size,
    activeAgents: getActiveAgents()
  };
  broadcast(createWsEnvelope('PRESENCE_UPDATE', presencePayload));
}

// REST Healthcheck & API routes
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ANIF Gabon DC Nkok E2EE Sovereign Hub',
    protocol: 'WebSocket Double Ratchet / WAF Protected',
    timestamp: new Date().toISOString(),
    activeClients: clientsMap.size,
    activeAgents: getActiveAgents()
  });
});

app.get('/api/messages', (_req, res) => {
  res.json({
    channels: CHANNELS.map((c) => c.id),
    messages: messagesStore
  });
});

app.get('/api/messages/:channelId', (req, res) => {
  const { channelId } = req.params;
  if (!ALLOWED_CHANNEL_IDS.has(channelId)) {
    return res.status(404).json({ error: 'Canal inconnu' });
  }
  const channelMessages = messagesStore[channelId] || [];
  res.json({
    channelId,
    count: channelMessages.length,
    messages: channelMessages
  });
});

app.post('/api/messages', restRateLimit, (req, res) => {
  const message = req.body as EncryptedMessage;
  if (!validateIncomingMessage(message, ALLOWED_CHANNEL_IDS)) {
    return res.status(400).json({ error: 'Payload message chiffré invalide' });
  }

  const { updated, isDuplicate } = appendWithCap(messagesStore, message, MAX_MESSAGES_PER_CHANNEL);
  messagesStore[message.canalId] = updated[message.canalId];

  if (!isDuplicate) {
    const channelDef = CHANNELS.find((c) => c.id === message.canalId);
    const channelCode = channelDef ? channelDef.code : message.canalId;

    const newMsgPayload: WsNewMessagePayload = { message, isBroadcast: true };
    broadcast(createWsEnvelope('NEW_MESSAGE', newMsgPayload));

    const notifPayload = buildNotificationFromMessage(message, channelCode);
    broadcast(createWsEnvelope('NOTIFICATION', notifPayload));
  }

  return res.json({ success: true, messageId: message.id, isDuplicate });
});

// Endpoint d'analyse IA des menaces et corrélation des logs WORM (Google GenAI)
app.post('/api/ai/threat-analysis', restRateLimit, async (req, res) => {
  const { auditLogs } = req.body;
  if (!Array.isArray(auditLogs) || auditLogs.length > 500) {
    return res.status(400).json({ error: 'Format auditLogs invalide' });
  }

  const { analyzeAuditThreatsHeuristic } = await import('./src/utils/threatAnalyzerLogic.js');
  const fallbackReport = analyzeAuditThreatsHeuristic(auditLogs);

  if (!isGeminiConfigured()) {
    // Mode heuristique si la clé n'est pas configurée
    return res.json(fallbackReport);
  }

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI();

    const logsSummary = auditLogs.slice(0, 20).map((l: any) => ({
      id: l.id,
      timestamp: l.timestampRFC3161,
      action: l.action,
      acteur: l.acteur,
      details: l.details
    }));

    const prompt = `Tu es un Expert Senior en Cybersécurité, SOC SIEM et Renseignement Financier pour l'ANIF Gabon (Enclave Souveraine Nkok Tier-III).
Analyse ces 20 derniers logs d'audit WORM scellés par arbre de Merkle pour identifier les schémas d'attaques complexes, notamment :
1. Tentatives de PIVOT LATÉRAL (ex: compromise d'un compte de faible niveau d'appui suivie d'accès vers DG/Magistrat Niv 1, clés RAM AES-GCM ou audit).
2. Attaques par force brute sur jetons FIDO2 ou Rate Limiting (DDoS).
3. Injections SQL/XSS ou exfiltration.

Logs WORM :
${JSON.stringify(logsSummary, null, 2)}

Réponds STRICTEMENT sous format JSON valide avec la structure suivante :
{
  "threatLevel": "CRITIQUE" | "HAUTE" | "MOYENNE" | "NOMINALE",
  "summary": "Résumé concis de la situation",
  "lateralPivotDetected": true | false,
  "detectedPatterns": [
    {
      "id": "THR-AI-01",
      "name": "Nom du motif",
      "category": "LATERAL_PIVOT" | "BRUTE_FORCE_CREDENTIAL_STUFFING" | "PRIVILEGE_ESCALATION_EXPLOIT" | "EXFILTRATION_WORM" | "REPETITIVE_DDOS",
      "mitreTechnique": "T1078 / T1021...",
      "severity": "CRITIQUE" | "HAUTE" | "MOYENNE",
      "confidenceScore": 95,
      "description": "Explication de la corrélation",
      "indicators": ["Indicateur 1", "Indicateur 2"],
      "involvedActors": ["AGT-XXX"],
      "timeline": {
        "start": "HH:MM",
        "end": "HH:MM",
        "eventCount": 3
      },
      "recommendedMitigation": "Recommandation opérationnelle",
      "kedbReference": "KEDB-042"
    }
  ],
  "correlatedLogIds": ["AUD-2026-0005", "AUD-2026-0004"],
  "mitreCoverage": ["T1078 (Valid Accounts)", "T1021 (Remote Services)"]
}`;

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const parsedJson = JSON.parse(response.text || '{}');
    return res.json({
      timestamp: new Date().toISOString(),
      threatLevel: parsedJson.threatLevel || fallbackReport.threatLevel,
      summary: parsedJson.summary || fallbackReport.summary,
      lateralPivotDetected: typeof parsedJson.lateralPivotDetected === 'boolean' ? parsedJson.lateralPivotDetected : fallbackReport.lateralPivotDetected,
      detectedPatterns: parsedJson.detectedPatterns?.length ? parsedJson.detectedPatterns : fallbackReport.detectedPatterns,
      correlatedLogIds: parsedJson.correlatedLogIds || fallbackReport.correlatedLogIds,
      aiModelUsed: `Gemini (${GEMINI_MODEL})`,
      mitreCoverage: parsedJson.mitreCoverage || fallbackReport.mitreCoverage
    });
  } catch (err) {
    console.warn('[AI SIEM] Échec de l\'analyse Gemini, bascule sur le moteur heuristique:', err);
    return res.json(fallbackReport);
  }
});

// Copilote d'investigation : l'appel au modèle reste côté serveur (la clé n'est jamais exposée au navigateur)
const COPILOT_SYSTEM_INSTRUCTION = `Vous êtes le Copilote d'Intelligence Financière de l'ANIF Gabon (Agence Nationale d'Investigation Financière, République Gabonaise).
Vous êtes expert en :
1. Lutte anti-blanchiment (LBC/FT) en zone CEMAC et Recommandation 29 du GAFI.
2. Procédures d'opposition et de séquestre conservatoire.
3. Détection des schémas de dissimulation transnationale (sociétés écrans, fractionnement, places offshore).
4. Procédures ITSM ITIL v4.
Il s'agit d'un environnement de démonstration : les dossiers sont fictifs. Ne demandez ni ne traitez aucune donnée personnelle réelle.
Répondez toujours de manière professionnelle, structurée, rigoureuse et en français.`;

app.post('/api/ai/copilot', restRateLimit, async (req, res) => {
  const { prompt, history, caseId } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) {
    return res.status(400).json({ error: 'Question invalide' });
  }
  if (!isGeminiConfigured()) {
    return res.status(503).json({ error: 'Modèle non configuré (GEMINI_API_KEY absente)' });
  }

  const safeHistory = (Array.isArray(history) ? history : [])
    .slice(-12)
    .filter(
      (m: unknown): m is { role: 'user' | 'model'; text: string } =>
        !!m &&
        typeof m === 'object' &&
        ((m as { role?: unknown }).role === 'user' || (m as { role?: unknown }).role === 'model') &&
        typeof (m as { text?: unknown }).text === 'string'
    )
    .map((m) => ({ role: m.role, parts: [{ text: m.text.slice(0, 4000) }] }));

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [...safeHistory, { role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction:
          COPILOT_SYSTEM_INSTRUCTION +
          (typeof caseId === 'string' ? `\nDossier fictif en cours : ${caseId.slice(0, 40)}.` : '')
      }
    });
    return res.json({ reply: response.text || 'Analyse terminée.', model: GEMINI_MODEL });
  } catch (err) {
    console.warn('[AI Copilot] Échec de l\'appel Gemini:', err);
    return res.status(502).json({ error: 'Le modèle est momentanément indisponible' });
  }
});

// Create HTTP and WebSocket servers
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD_BYTES });

// Refuse les connexions WebSocket ouvertes depuis un autre site (détournement inter-origines)
function isSameOriginUpgrade(request: http.IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true; // clients non navigateur (outils, tests)
  try {
    const originHost = new URL(origin).host;
    const forwardedHost = (request.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim();
    return originHost === request.headers.host || originHost === forwardedHost;
  } catch {
    return false;
  }
}

server.on('upgrade', (request, socket, head) => {
  const url = request.url || '';
  if (url.startsWith('/ws')) {
    if (!isSameOriginUpgrade(request) || clientsMap.size >= MAX_WS_CLIENTS) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

let clientIdCounter = 1;

wss.on('connection', (ws: WebSocket, req) => {
  const clientId = `CLI-${Date.now()}-${clientIdCounter++}`;
  const remoteIp = req.socket.remoteAddress || '127.0.0.1';
  console.log(`[WebSocket] Nouveau client connecté: ${clientId} (${remoteIp})`);

  const clientInfo: ConnectedClient = {
    id: clientId,
    ws,
    joinedAt: new Date().toISOString()
  };
  clientsMap.set(clientId, clientInfo);
  const wsLimiter = new TokenBucketRateLimiter(20, 4);

  // 1. Send INIT payload with full state & presence
  const initPayload: WsInitPayload = {
    messages: messagesStore,
    connectedClients: clientsMap.size,
    activeAgents: getActiveAgents(),
    serverTimeRFC: new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC'
  };
  ws.send(createWsEnvelope('INIT', initPayload));

  // Broadcast presence update to others
  broadcastPresence();

  // 2. Handle incoming WebSocket frames
  ws.on('message', (rawData) => {
    if (!wsLimiter.consume().allowed) {
      return; // trame ignorée : débit excessif
    }
    const str = rawData.toString();
    const envelope = parseWsMessage(str);
    if (!envelope) {
      console.warn(`[WebSocket] Message ignoré (format JSON invalide): ${str.substring(0, 50)}`);
      return;
    }

    switch (envelope.type) {
      case 'AGENT_JOIN': {
        const payload = (envelope.payload ?? {}) as Record<string, unknown>;
        const level = Number(payload.roleNiveau);
        if (
          typeof payload.matricule !== 'string' || payload.matricule.length === 0 || payload.matricule.length > 64 ||
          typeof payload.nom !== 'string' || payload.nom.length > 120 ||
          !Number.isInteger(level) || level < 1 || level > 5
        ) {
          console.warn('[WebSocket] AGENT_JOIN rejeté (champs invalides)');
          return;
        }
        // Identité déclarative : démonstration uniquement, aucune authentification n'est faite ici.
        clientInfo.matricule = payload.matricule;
        clientInfo.nom = payload.nom;
        clientInfo.roleNiveau = level as AccreditationLevel;
        clientInfo.canalId =
          typeof payload.canalId === 'string' && ALLOWED_CHANNEL_IDS.has(payload.canalId) ? payload.canalId : undefined;
        console.log(`[WebSocket] Agent identifié: ${payload.nom} (${payload.matricule}) sur canal ${payload.canalId || 'défaut'}`);
        broadcastPresence();
        break;
      }

      case 'SEND_MESSAGE': {
        const payload = (envelope.payload ?? {}) as { message?: unknown };
        const msg = payload.message;

        if (!validateIncomingMessage(msg, ALLOWED_CHANNEL_IDS)) {
          console.warn(`[WebSocket] Message rejeté (champs obligatoires manquants)`);
          return;
        }

        // Apply message into server-authoritative store
        const { updated, isDuplicate } = appendWithCap(messagesStore, msg, MAX_MESSAGES_PER_CHANNEL);
        messagesStore[msg.canalId] = updated[msg.canalId];

        console.log(`[WebSocket] Message acheminé vers #${msg.canalId} par ${msg.auteur} (${msg.matricule}) [Duplicate: ${isDuplicate}]`);

        if (!isDuplicate) {
          const channelDef = CHANNELS.find((c) => c.id === msg.canalId);
          const channelCode = channelDef ? channelDef.code : msg.canalId;

          // 1. Broadcast new message to ALL clients
          const newMsgPayload: WsNewMessagePayload = {
            message: msg,
            isBroadcast: true
          };
          broadcast(createWsEnvelope('NEW_MESSAGE', newMsgPayload));

          // 2. Broadcast server-pushed notification to all OTHER clients
          const notifPayload: WsNotificationPayload = buildNotificationFromMessage(msg, channelCode);
          broadcast(createWsEnvelope('NOTIFICATION', notifPayload), clientId);
        }
        break;
      }

      case 'PING': {
        ws.send(createWsEnvelope('PONG', { time: Date.now() }));
        break;
      }

      default:
        console.log(`[WebSocket] Type d'événement non traité: ${String(envelope.type).slice(0, 40)}`);
    }
  });

  ws.on('close', () => {
    console.log(`[WebSocket] Client déconnecté: ${clientId}`);
    clientsMap.delete(clientId);
    broadcastPresence();
  });

  ws.on('error', (err) => {
    console.error(`[WebSocket] Erreur socket client ${clientId}:`, err);
    clientsMap.delete(clientId);
    broadcastPresence();
  });
});

// Setup Vite in Dev or Static Serving in Prod
async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true }
    });
    app.use(vite.middlewares);
    console.log('[Dev] Vite middleware monté dans Express.');
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
    console.log('[Prod] Fichiers statiques servis depuis dist.');
  }

  server.listen(PORT, HOST, () => {
    console.log(`[Server] Serveur Souverain ANIF Gabon opérationnel sur http://${HOST}:${PORT}`);
    console.log(`[Server] WebSocket actif sur ws://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server] Échec critique du démarrage serveur:', err);
  process.exit(1);
});
