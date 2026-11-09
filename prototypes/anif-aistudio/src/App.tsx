import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { ForensicWatermark } from './components/ForensicWatermark';
import { ChatPane } from './components/ChatPane';
import { ItsmPane } from './components/ItsmPane';
import { ConvertIncidentModal } from './components/ConvertIncidentModal';
import { NewTicketModal } from './components/NewTicketModal';
import { TicketDetailModal } from './components/TicketDetailModal';
import { ArchitectureModal } from './components/ArchitectureModal';
import { BentoGridDashboard } from './components/BentoGridDashboard';
import { OwaspMatrixModal } from './components/OwaspMatrixModal';
import { MegaPromptModal } from './components/MegaPromptModal';
import { WebAuthnModal } from './components/WebAuthnModal';
import { SensitiveAction, WebAuthnAssertionResult } from './utils/webauthn';
import { generateSignedAuditCsv, triggerCsvDownload } from './utils/wormExport';
import {
  UserProfile,
  AccreditationLevel,
  Channel,
  EncryptedMessage,
  ItsmTicket,
  BotMessage,
  AuditEntry,
  BiometricLogMetadata,
  TicketPriority,
  TicketStatus
} from './types';
import {
  ACCREDITATION_PROFILES,
  CHANNELS,
  INITIAL_MESSAGES,
  INITIAL_TICKETS,
  INITIAL_AUDIT_LOGS
} from './data/initialData';
import {
  generateSessionKey,
  encryptAESGCM,
  sha256Hex,
  computeMerkleLeaf,
  formatRFC3161Timestamp
} from './utils/crypto';
import { TokenBucketRateLimiter } from './utils/rateLimiter';
import { validateSecurePayload, SafeTextSchema } from './utils/validation';
import { SecurityMonitorWorker } from './utils/securityMonitor';
import { cyberAudio } from './utils/audio';
import { useRealtimeSocket } from './utils/useRealtimeSocket';

export default function App() {
  // 1. Profil Actuel (Défaut : Niveau 2 - Analyste Financier Senior)
  const [currentUser, setCurrentUser] = useState<UserProfile>(ACCREDITATION_PROFILES[2]);

  // 2. Canaux et Messagerie Instantanée WebSocket (Hub Régalien DC Nkok)
  const [channels] = useState<Channel[]>(CHANNELS);
  const [activeChannel, setActiveChannel] = useState<Channel>(CHANNELS[0]);

  // Hook WebSocket temps réel connecté au serveur d'enclave souverain
  const {
    connectionStatus: wsStatus,
    latencyMs: wsLatencyMs,
    onlineAgentsCount,
    messagesByChannel,
    sendRealtimeMessage
  } = useRealtimeSocket({
    currentUser,
    activeChannel,
    onIncomingNotification: (notif) => {
      if (notif.senderMatricule !== currentUser.matricule) {
        cyberAudio.playTacticalClick();
        showToast(`[PUSH WS DC NKOK] ${notif.title} : ${notif.body}`);
      }
    },
    onRemoteMessageReceived: (msg) => {
      if (msg.matricule !== currentUser.matricule) {
        cyberAudio.playTacticalClick();
      }
    }
  });

  // 3. Clés Cryptographiques de Session
  const [sessionKey, setSessionKey] = useState<CryptoKey | null>(null);
  const [sessionKeyFingerprint, setSessionKeyFingerprint] = useState<string>('Initialisation...');

  // 4. Système ITSM et Incidents
  const [tickets, setTickets] = useState<ItsmTicket[]>(INITIAL_TICKETS);

  // 5. Bot SI & Diagnostic
  const [botMessages, setBotMessages] = useState<BotMessage[]>([
    {
      id: 'BOT-INIT',
      emetteur: 'bot',
      contenu: 'Bonjour Agent. Je supervise l\'infrastructure informatique de l\'ANIF déployée au Data Center National Tier III de Nkok. Utilisez les boutons de diagnostic rapide ou posez vos questions techniques.',
      timestamp: '19:40',
      telemetrie: {
        cible: 'Cluster Nkok ZES',
        latenceMs: 8.4,
        statut: 'NOMINAL',
        rpo: '0 sec (synchrone)',
        rto: '< 15 min'
      }
    }
  ]);

  // 6. Registre d'Audit WORM (Merkle Chain)
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>(INITIAL_AUDIT_LOGS);

  // 7. Modals et Sécurité Visuelle
  const [activeView, setActiveView] = useState<'bento' | 'split'>('bento');
  const [watermarkEnabled, setWatermarkEnabled] = useState<boolean>(true);
  const [convertingMessage, setConvertingMessage] = useState<EncryptedMessage | null>(null);
  const [isNewTicketOpen, setIsNewTicketOpen] = useState<boolean>(false);
  const [selectedTicketForDetail, setSelectedTicketForDetail] = useState<ItsmTicket | null>(null);
  const [isArchitectureOpen, setIsArchitectureOpen] = useState<boolean>(false);
  const [isOwaspModalOpen, setIsOwaspModalOpen] = useState<boolean>(false);
  const [isMegaPromptOpen, setIsMegaPromptOpen] = useState<boolean>(false);
  const [megaPromptProjectIdea, setMegaPromptProjectIdea] = useState<string>(
    "Plateforme d'Investigation Financière Souveraine (E2EE Zero-Knowledge + ITSM ITIL v4)"
  );
  const [activeAccent, setActiveAccent] = useState<'cyan' | 'purple' | 'emerald' | 'amber'>('cyan');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [rateLimiter] = useState(() => new TokenBucketRateLimiter(10, 2));

  // 8. Background Worker : Sentinelle Autonome de Sécurité
  // Surveille auditLogs pour détection d'accès non autorisés ou dépassements de débit répétés
  const securityWorkerRef = React.useRef(new SecurityMonitorWorker({ repetitionThreshold: 3, cooldownMs: 15000 }));

  // État de l'autorisation biométrique WebAuthn / FIDO2
  const [webAuthnAction, setWebAuthnAction] = useState<SensitiveAction | null>(null);
  const [pendingAuthorizedCallback, setPendingAuthorizedCallback] = useState<
    ((assertion: WebAuthnAssertionResult) => Promise<void>) | null
  >(null);

  const triggerSensitiveActionWithBiometrics = (
    action: SensitiveAction,
    callback: (assertion: WebAuthnAssertionResult) => Promise<void>
  ) => {
    setWebAuthnAction(action);
    setPendingAuthorizedCallback(() => callback);
  };

  // Initialisation du moteur cryptographique Web Crypto natif
  useEffect(() => {
    async function initCrypto() {
      try {
        const key = await generateSessionKey();
        setSessionKey(key);
        const fp = await sha256Hex(Date.now().toString() + Math.random().toString());
        setSessionKeyFingerprint(`${fp.substring(0, 6)}...${fp.substring(fp.length - 6)} (X25519)`);
      } catch (err) {
        console.error('Erreur initialisation cryptographie locale:', err);
      }
    }
    initCrypto();
  }, []);

  // Décompte dynamique des SLA en temps réel
  useEffect(() => {
    const timer = setInterval(() => {
      setTickets((prev) =>
        prev.map((t) => {
          if (t.statut === 'RESOLU' || t.statut === 'CLOS_KEDB') return t;
          return {
            ...t,
            slaSecondesRestantes: t.slaSecondesRestantes - 1
          };
        })
      );
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Background Worker Effect : Surveillance continue des événements d'audit WORM
  // Détecte les attaques répétitives ('Rate Limit' / 'Unauthorized Access')
  // et génère automatiquement un ticket d'incident ITSM Haute Priorité P1
  useEffect(() => {
    const detectedTicket = securityWorkerRef.current.inspectLogs(auditLogs, tickets);
    if (detectedTicket) {
      // 1. Ajouter le ticket P1 en tête de file
      setTickets((prev) => [detectedTicket, ...prev]);

      // 2. Alerte sonore de défense cybernétique
      cyberAudio.playShieldBlock();

      // 3. Sceller la création de l'alerte de sécurité dans l'arbre de Merkle WORM
      appendAuditLog(
        'ALERTE_SECURITE_P1_AUTOMATIQUE',
        `[SENTINELLE WAF] Incident ${detectedTicket.id} (P1 CRITIQUE) généré automatiquement suite à détection d'attaques répétitives (${detectedTicket.titre})`
      );

      // 4. Notification visuelle critique
      showToast(`🚨 SENTINELLE WAF : Ticket ${detectedTicket.id} (P1 CRITIQUE) créé suite à attaques répétées !`);
    }
  }, [auditLogs, tickets]);

  // Affichage d'une notification discrète
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Ajout d'une entrée scellée dans l'arbre de Merkle WORM
  const appendAuditLog = async (action: string, details: string, biometrie?: BiometricLogMetadata) => {
    const prevHash = auditLogs[0]?.hachageActuel || '0000000000000000000000000000000000000000000000000000000000000000';
    const timestampRFC = formatRFC3161Timestamp();
    const leaf = await computeMerkleLeaf(
      prevHash,
      action,
      currentUser.matricule,
      details,
      timestampRFC
    );

    const newEntry: AuditEntry = {
      index: auditLogs.length + 1,
      id: `AUD-2026-0${auditLogs.length + 10}`,
      timestampRFC3161: timestampRFC,
      action,
      acteur: currentUser.matricule,
      roleNiveau: currentUser.roleNiveau,
      details,
      hachagePrecedent: prevHash,
      hachageActuel: leaf,
      estValide: true,
      biometrie
    };

    setAuditLogs((prev) => [newEntry, ...prev]);
  };

  // Commutation d'Habilitation (Niveaux 1 à 5) avec contrôle biométrique pour les rôles sensibles
  const handleRoleChange = async (level: AccreditationLevel) => {
    const newProfile = ACCREDITATION_PROFILES[level];
    // Les élévations vers Niveau 1 (Direction Générale / Magistrature) ou Niveau 3 (Admin SSI) requièrent l'autorisation biométrique
    if (level === 1 || level === 3) {
      triggerSensitiveActionWithBiometrics(
        {
          id: `role-switch-${Date.now()}`,
          type: 'SWITCH_HABILITATION',
          title: `Élévation Privilège : ${newProfile.titre}`,
          description: `Passage vers l'accréditation ${newProfile.habilitation}. Contrôle biométrique d'identité FIDO2 obligatoire.`,
          targetResource: `Niveau ${level} : ${newProfile.nom}`,
          severity: level === 1 ? 'TRES_SECRET' : 'CRITIQUE'
        },
        async (assertion) => {
          setCurrentUser(newProfile);
          await appendAuditLog(
            'COMMUTATION_PRIVILEGE_WEBAUTHN',
            `Accréditation Niveau ${level} (${newProfile.nom}) débloquée via biométrie WebAuthn (${assertion.biometricMethod})`,
            {
              status: 'SUCCESS',
              actionType: 'SWITCH_HABILITATION',
              actionTitle: `Élévation Privilège : ${newProfile.titre}`,
              targetResource: `Niveau ${level} : ${newProfile.nom}`,
              severity: level === 1 ? 'TRES_SECRET' : 'CRITIQUE',
              biometricMethod: assertion.biometricMethod,
              authenticatorType: assertion.biometricMethod.includes('YubiKey') ? 'SECURITY_KEY' : 'PLATFORM',
              userVerification: 'VERIFIED',
              credentialId: assertion.credentialId,
              flags: {
                userPresent: true,
                userVerified: true,
                backupEligible: true,
                backupState: false
              },
              signaturePreview: (assertion.signatureHex || '3045022100...').substring(0, 32) + '...'
            }
          );
          showToast(`Habilitation Niveau ${level} activée par signature biométrique.`);
        }
      );
    } else {
      setCurrentUser(newProfile);
      await appendAuditLog(
        'COMMUTATION_PRIVILEGE_ABAC',
        `Session basculée vers ${newProfile.nom} - Accréditation Niveau ${level} (${newProfile.habilitation})`
      );
      showToast(`Habilitation actualisée : ${newProfile.nom} (Niveau ${level})`);
    }
  };

  // Envoi d'un message chiffré dans le canal actif avec validation Zod et Rate Limiting
  const handleSendMessage = async (text: string, retentionHours: number = 24, attachFile?: boolean) => {
    // 1. Contrôle Rate Limiter (Token Bucket anti-DDoS / Brute Force)
    const rateCheck = rateLimiter.consume(1);
    if (!rateCheck.allowed) {
      showToast(`Alerte Rate Limiting (HTTP 429) : Seuil dépassé. Patientez ${rateCheck.retryAfterSeconds}s.`);
      await appendAuditLog('RATE_LIMIT_BLOCKED', 'Tentative de transmission rejetée par le WAF (Token Bucket épuisé)');
      return;
    }

    // 2. Contrôle Strict Zod (Anti-XSS et Anti-SQLi)
    const zodValidation = validateSecurePayload(SafeTextSchema, text);
    if (!zodValidation.success) {
      showToast(`Erreur Sécurité WAF : ${zodValidation.errors[0]}`);
      await appendAuditLog('WAF_XSS_SQLI_BLOCKED', `Pattern suspect intercepté : ${zodValidation.errors[0]}`);
      return;
    }

    if (!sessionKey) return;

    // Chiffrement matériel local AES-GCM
    const encResult = await encryptAESGCM(sessionKey, text);
    const timestampRFC = formatRFC3161Timestamp();
    const nowTime = new Date().toLocaleTimeString().substring(0, 5);

    const newMsg: EncryptedMessage = {
      id: `MSG-${Date.now()}`,
      canalId: activeChannel.id,
      auteur: `${currentUser.nom} (${currentUser.titre.split(' ')[0]})`,
      matricule: currentUser.matricule,
      roleNiveau: currentUser.roleNiveau,
      texteClair: text,
      chiffreHex: encResult.cipherHex,
      ivHex: encResult.ivHex,
      tagHex: encResult.tagHex,
      timestamp: nowTime,
      timestampRFC3161: timestampRFC,
      classification: activeChannel.type === 'dos' ? 'CONFIDENTIEL OPÉRATIONNEL' : 'INTERNE',
      estEphemere: retentionHours < 720,
      pieceJointe: attachFile
        ? {
            nom: 'Scelles_Financiers_BGF88.dat.enc',
            taille: '1.8 Mo',
            sha256: '4fa8710b2c1189bc00192a54ceb84791fe3302bc56aa71a441bb8709caee1290'
          }
        : undefined
    };

    // Transmission WebSocket temps réel vers le serveur régalien (broadcast multi-agents + push notif)
    sendRealtimeMessage(newMsg);

    await appendAuditLog(
      'MESSAGE_CHIFFRE_TRANSMIS',
      `Canal #${activeChannel.code} - Payload AES-256-GCM acheminé vers cluster Nkok (Zero-Knowledge validé)`
    );
  };

  // Conversion d'un message en incident ITSM caviardé
  const handleConfirmConvertIncident = async (
    title: string,
    sanitizedDescription: string,
    priority: TicketPriority,
    stationId: string
  ) => {
    const newId = `INC-2026-0${tickets.length + 85}`;
    const newTicket: ItsmTicket = {
      id: newId,
      titre: title,
      descriptionAnonymisee: sanitizedDescription,
      priorite: priority,
      statut: 'NOUVEAU',
      demandeurMatricule: currentUser.matricule,
      demandeurNom: currentUser.nom,
      stationSource: stationId,
      mttaMinutesMax: priority === 'P1' ? 15 : priority === 'P2' ? 30 : 120,
      mttrMinutesMax: priority === 'P1' ? 120 : priority === 'P2' ? 240 : 480,
      creeLe: new Date().toLocaleTimeString().substring(0, 5),
      creeLeISO: new Date().toISOString(),
      slaSecondesRestantes: priority === 'P1' ? 7200 : priority === 'P2' ? 14400 : 28800,
      estEnEscalade: false,
      estSousContrainte48h: priority === 'P1'
    };

    setTickets((prev) => [newTicket, ...prev]);
    setConvertingMessage(null);

    await appendAuditLog(
      'CONVERSION_INCIDENT_PASSERELLE',
      `Ticket ${newId} (${priority}) créé depuis chat avec décontamination PII/bancaire conforme Art. 29 GAFI`
    );

    showToast(`Incident ${newId} transmis au Helpdesk SSI avec caviardage complet.`);
  };

  // Création manuelle d'un ticket
  const handleCreateManualTicket = async (
    title: string,
    description: string,
    priority: TicketPriority,
    isLegalConstraint: boolean
  ) => {
    const newId = `INC-2026-0${tickets.length + 85}`;
    const newTicket: ItsmTicket = {
      id: newId,
      titre: title,
      descriptionAnonymisee: description,
      priorite: priority,
      statut: 'NOUVEAU',
      demandeurMatricule: currentUser.matricule,
      demandeurNom: currentUser.nom,
      stationSource: currentUser.stationIP,
      mttaMinutesMax: priority === 'P1' ? 15 : priority === 'P2' ? 30 : 120,
      mttrMinutesMax: priority === 'P1' ? 120 : priority === 'P2' ? 240 : 480,
      creeLe: new Date().toLocaleTimeString().substring(0, 5),
      creeLeISO: new Date().toISOString(),
      slaSecondesRestantes: priority === 'P1' ? 7200 : priority === 'P2' ? 14400 : 28800,
      estEnEscalade: false,
      estSousContrainte48h: isLegalConstraint || priority === 'P1'
    };

    setTickets((prev) => [newTicket, ...prev]);
    setIsNewTicketOpen(false);

    await appendAuditLog('TICKET_ITSM_CREATION_MANUELLE', `Ticket ${newId} (${priority}) ouvert par ${currentUser.matricule}`);
    showToast(`Ticket ${newId} enregistré sous ITIL v4.`);
  };

  // Résolution d'un ticket
  const handleResolveTicket = async (ticketId: string) => {
    setTickets((prev) =>
      prev.map((t) => (t.id === ticketId ? { ...t, statut: 'RESOLU' as TicketStatus } : t))
    );
    await appendAuditLog('INCIDENT_RESOLU_KEDB', `Incident ${ticketId} résolu et archivé dans la base KEDB.`);
    showToast(`Incident ${ticketId} résolu. Procédure consignée dans la KEDB souveraine.`);
  };

  // Mise à jour du statut d'un ticket
  const handleUpdateTicketStatus = async (ticketId: string, newStatus: TicketStatus, solution?: string) => {
    setTickets((prev) =>
      prev.map((t) =>
        t.id === ticketId
          ? { ...t, statut: newStatus, solutionKEDB: solution || t.solutionKEDB }
          : t
      )
    );
    await appendAuditLog('TRANSITION_STATUT_ITSM', `Ticket ${ticketId} basculé vers statut ${newStatus}`);
    showToast(`Statut ticket ${ticketId} mis à jour : ${newStatus}`);
  };

  // Purge cryptographique d'urgence (Zeroization) protégée par WebAuthn
  const handleShredKeys = () => {
    triggerSensitiveActionWithBiometrics(
      {
        id: `shred-${Date.now()}`,
        type: 'PURGE_MEMOIRE',
        title: 'Purge Mémoire Vive (RAM Zeroization)',
        description: 'Destruction immédiate des clés AES-256-GCM et réinitialisation de la mémoire volatile de session.',
        targetResource: 'Buffer Clés RAM (AES-GCM)',
        severity: 'CRITIQUE'
      },
      async (assertion) => {
        const key = await generateSessionKey();
        setSessionKey(key);
        const newFp = await sha256Hex(Date.now().toString());
        setSessionKeyFingerprint(`${newFp.substring(0, 6)}...${newFp.substring(newFp.length - 6)} (REVOKED_NEW)`);

        await appendAuditLog(
          'PURGE_CRYPTOGRAPHIQUE_WEBAUTHN',
          `RAM Zeroization autorisée par signature biométrique WebAuthn (${assertion.biometricMethod})`,
          {
            status: 'SUCCESS',
            actionType: 'SHRED_SESSION_KEYS',
            actionTitle: 'Purge Mémoire Vive (RAM Zeroization)',
            targetResource: 'Buffer Clés RAM (AES-256-GCM)',
            severity: 'CRITIQUE',
            biometricMethod: assertion.biometricMethod,
            authenticatorType: assertion.biometricMethod.includes('YubiKey') ? 'SECURITY_KEY' : 'PLATFORM',
            userVerification: 'VERIFIED',
            credentialId: assertion.credentialId,
            flags: {
              userPresent: true,
              userVerified: true,
              backupEligible: true,
              backupState: false
            },
            signaturePreview: (assertion.signatureHex || '3045022100...').substring(0, 32) + '...'
          }
        );
        showToast('Alerte de Sécurité : Clés de session effacées et mémoire purgée après vérification biométrique.');
      }
    );
  };

  // Diagnostic rapide exécuté par le Bot SI
  const handleRunBotDiagnostic = async (type: 'nkok' | 'keycloak' | 'minio' | 'kedb') => {
    const timeStr = new Date().toLocaleTimeString().substring(0, 5);

    if (type === 'nkok') {
      const resp: BotMessage = {
        id: `BOT-${Date.now()}`,
        emetteur: 'bot',
        contenu: `[RÉSULTAT CONTRÔLE DE LIAISON DATA CENTER NKOK]\n• Route BGP Fibre Primaire (Libreville - ZES Nkok) : OPÉRATIONNELLE\n• Latence ICMP / gRPC : 7.9 ms (SLA < 100ms respecté)\n• Synchronisation Postgres HA : SYNCHRONE (0 sec de décalage, RPO=0)\n• Quorum Raft NATS JetStream : 3/3 Nœuds Actifs`,
        timestamp: timeStr,
        telemetrie: {
          cible: 'DC Nkok Tier III',
          latenceMs: 7.9,
          statut: 'OPTIMAL',
          rpo: '0 sec',
          rto: 'Immédiat'
        }
      };
      setBotMessages((prev) => [...prev, resp]);
      await appendAuditLog('DIAGNOSTIC_RESEAU_NKOK', 'Contrôle d\'intégrité de liaison Fibre optique Libreville - Nkok validé.');
    } else if (type === 'keycloak') {
      const resp: BotMessage = {
        id: `BOT-${Date.now()}`,
        emetteur: 'bot',
        contenu: `[CONTRÔLE FOURNISSEUR D'IDENTITÉ IAM KEYCLOAK FIDO2]\n• Service WebAuthn / FIDO2 : ACTIF\n• Certificats Matériels YubiKey : 142 clés synchronisées\n• Intégrité des jetons TPM 2.0 : 100% conformes à la directive ANINF\n• Aucun compteur de rejeu suspect détecté.`,
        timestamp: timeStr,
        telemetrie: {
          cible: 'Keycloak SSO Cluster',
          latenceMs: 4.1,
          statut: 'NOMINAL'
        }
      };
      setBotMessages((prev) => [...prev, resp]);
    } else if (type === 'minio') {
      const resp: BotMessage = {
        id: `BOT-${Date.now()}`,
        emetteur: 'bot',
        contenu: `[CONTRÔLE DU STOCKAGE SCELLE S3 MINIO SOUVERAIN]\n• Compartiment /anif-scelles-enquetes : CHIFFRÉ AES-256-GCM\n• Réplication multi-sites : Active vers nœud de réplication Libreville\n• Conformité WORM Object Lock : ACTIVÉ (Rétention légale 10 ans)`,
        timestamp: timeStr,
        telemetrie: {
          cible: 'MinIO S3 Cluster',
          latenceMs: 9.2,
          statut: 'OPTIMAL'
        }
      };
      setBotMessages((prev) => [...prev, resp]);
    } else if (type === 'kedb') {
      const resp: BotMessage = {
        id: `BOT-${Date.now()}`,
        emetteur: 'bot',
        contenu: `[BASE D'ERREURS CONNUES - RÉFÉRENTIEL ITIL v4]\n3 articles certifiés disponibles :\n1. ERR-NET-NKOK-FIBER (Bascule boucle Sud Owendo)\n2. ERR-S3-MINIO-403 (Recalcul horodatage NTP)\n3. ERR-FIDO2-SYNC-LOCKED (Réinitialisation compteur de séquence)`,
        timestamp: timeStr
      };
      setBotMessages((prev) => [...prev, resp]);
    }
  };

  // Traitement d'un prompt utilisateur vers le Bot SI
  const handleSendBotPrompt = (prompt: string) => {
    const timeStr = new Date().toLocaleTimeString().substring(0, 5);
    const userMsg: BotMessage = {
      id: `USR-${Date.now()}`,
      emetteur: 'utilisateur',
      contenu: prompt,
      timestamp: timeStr
    };

    let replyText = `Reçu "${prompt}". Après interrogation des sondes de télémétrie du Data Center de Nkok : l'ensemble des services d'investigation financière et de messagerie Zero-Knowledge opèrent nominalement.`;
    if (prompt.toLowerCase().includes('latence') || prompt.toLowerCase().includes('nkok')) {
      replyText = `Analyse en cours : La liaison vers Nkok affiche 8.2ms de latence moyenne avec 0% de perte de paquets. Le transit des flux chiffrés est optimal.`;
    } else if (prompt.toLowerCase().includes('fido') || prompt.toLowerCase().includes('clé')) {
      replyText = `Module IAM : Le service FIDO2 est actif. En cas de blocage d'une clé physique, utilisez la procédure KEDB-042 pour déverrouiller le compteur de séquence.`;
    }

    const botReply: BotMessage = {
      id: `BOT-${Date.now() + 1}`,
      emetteur: 'bot',
      contenu: replyText,
      timestamp: timeStr,
      telemetrie: {
        cible: 'Analyseur Télémétrique SSI',
        latenceMs: 8.2,
        statut: 'NOMINAL'
      }
    };

    setBotMessages((prev) => [...prev, userMsg, botReply]);
  };

  // Téléchargement sécurisé et cryptographiquement signé du journal d'audit WORM (CSV),
  // obligatoirement protégé par autorisation biométrique WebAuthn (Touch ID, Windows Hello, YubiKey)
  const handleDownloadWormAudit = () => {
    triggerSensitiveActionWithBiometrics(
      {
        id: `worm-export-${Date.now()}`,
        type: 'EXPORT_AUDIT_WORM',
        title: 'Download WORM Audit (Export CSV Signé)',
        description: 'Extraction régalienne et signature cryptographique du registre d\'audit WORM scellé par arbre de Merkle (RFC 3161).',
        targetResource: `Registre WORM (${auditLogs.length} blocs scellés Merkle)`,
        severity: 'CRITIQUE'
      },
      async (assertion) => {
        // 1. Génération du fichier CSV signé avec empreintes de feuilles Merkle et horodatage RFC 3161
        const { csvContent, filename, merkleRootSeal, documentSignature } = await generateSignedAuditCsv({
          auditLogs,
          currentUser,
          assertion,
          exportReason: 'Contrôle réglementaire COBAC / Réquisition judiciaire régalienne'
        });

        // 2. Déclenchement du téléchargement navigateur
        triggerCsvDownload(csvContent, filename);

        // 3. Scellement de l'événement d'exportation dans le registre WORM lui-même
        await appendAuditLog(
          'EXPORT_AUDIT_WORM_CSV_SIGNE',
          `Export CSV WORM signé via ${assertion.biometricMethod} par ${currentUser.matricule} (Sceau: ${merkleRootSeal.substring(0, 16)}..., Signature: ${documentSignature.substring(0, 16)}...)`,
          {
            status: 'SUCCESS',
            actionType: 'EXPORT_AUDIT_WORM',
            actionTitle: 'Download WORM Audit (Export CSV Signé)',
            targetResource: `Registre WORM (${auditLogs.length} blocs scellés Merkle)`,
            severity: 'CRITIQUE',
            biometricMethod: assertion.biometricMethod,
            authenticatorType: assertion.biometricMethod.includes('YubiKey') ? 'SECURITY_KEY' : 'PLATFORM',
            userVerification: 'VERIFIED',
            credentialId: assertion.credentialId,
            flags: {
              userPresent: true,
              userVerified: true,
              backupEligible: true,
              backupState: false
            },
            signaturePreview: documentSignature.substring(0, 32) + '...'
          }
        );

        showToast(`Audit WORM signé téléchargé avec succès : ${filename}`);
      }
    );
  };

  // Simulation d'une rafale d'attaques répétitives pour tester la sentinelle autonome
  const handleSimulateRepetitiveAttack = async (type: 'RATE_LIMIT' | 'UNAUTHORIZED') => {
    cyberAudio.playShieldBlock();
    if (type === 'RATE_LIMIT') {
      await appendAuditLog('RATE_LIMIT_BLOCKED', 'Attaque DDoS : Débit de 45 req/s rejeté par le WAF (Token Bucket 0/10)');
      await appendAuditLog('RATE_LIMIT_BLOCKED', 'Attaque DDoS : Débit de 62 req/s rejeté par le WAF (Token Bucket 0/10)');
      await appendAuditLog('RATE_LIMIT_BLOCKED', 'Attaque DDoS : Débit de 88 req/s rejeté par le WAF (Token Bucket 0/10)');
      showToast('Rafale de 3 dépassements de débit (Rate Limit) injectée dans l\'audit WORM.');
    } else {
      await appendAuditLog('ACCES_REFUSE_ZERO_KNOWLEDGE', 'Tentative d\'accès non autorisé au canal d\'investigation confidentiel DOS-089');
      await appendAuditLog('UNAUTHORIZED_ACCESS_FIDO2', 'Tentative de signature avec jeton FIDO2 révoqué');
      await appendAuditLog('WAF_XSS_SQLI_BLOCKED', 'Tentative d\'injection SQL bloquée : UNION SELECT * FROM dossiers');
      showToast('Rafale de 3 violations d\'accès non autorisé injectée dans l\'audit WORM.');
    }
  };

  // Alerte d'escalade P1 sous contrainte 48h protégée par WebAuthn
  const handleEmergencyAlert48h = () => {
    triggerSensitiveActionWithBiometrics(
      {
        id: `crisis-${Date.now()}`,
        type: 'OPPOSITION_48H',
        title: 'Décret d\'Opposition Conservatoire 48h (Art. 29 GAFI)',
        description: 'Ordonnance de blocage immédiat des 1 450 000 000 FCFA sous séquestre et notification au Parquet Spécial.',
        targetResource: 'Comptes BGFIBank GA039-40001 (Dossier #DOS-2026-441)',
        severity: 'CRITIQUE'
      },
      async (assertion) => {
        await appendAuditLog(
          'ESCALADE_CRISE_DECRET_48H_WEBAUTHN',
          `Décret d'opposition 48h validé par biométrie WebAuthn (${assertion.biometricMethod}) - Autorisé par ${currentUser.nom} (${currentUser.matricule})`,
          {
            status: 'SUCCESS',
            actionType: 'OPPOSITION_48H',
            actionTitle: 'Décret d\'Opposition Conservatoire 48h (Art. 29 GAFI)',
            targetResource: 'Comptes BGFIBank GA039-40001 (Dossier #DOS-2026-441)',
            severity: 'CRITIQUE',
            biometricMethod: assertion.biometricMethod,
            authenticatorType: assertion.biometricMethod.includes('YubiKey') ? 'SECURITY_KEY' : 'PLATFORM',
            userVerification: 'VERIFIED',
            credentialId: assertion.credentialId,
            flags: {
              userPresent: true,
              userVerified: true,
              backupEligible: true,
              backupState: false
            },
            signaturePreview: (assertion.signatureHex || '3045022100...').substring(0, 32) + '...'
          }
        );
        showToast('Cellule de Crise Activée : Gel conservatoire 48h signé par biométrie et notifié au DG.');
      }
    );
  };

  // Gestionnaire d'ouverture directe du module WebAuthn / FIDO2
  const handleOpenWebAuthnDirectly = (action?: SensitiveAction) => {
    const targetAction: SensitiveAction = action || {
      id: `bio-inspect-${Date.now()}`,
      type: 'REGISTER_AUTHENTICATOR',
      title: 'Gestionnaire Biométrique FIDO2 / WebAuthn',
      description: 'Vérification matérielle de l\'authentificateur local et test d\'assertion cryptographique.',
      targetResource: currentUser.fingerprintFIDO,
      severity: 'HAUTE'
    };
    triggerSensitiveActionWithBiometrics(targetAction, async (assertion) => {
      await appendAuditLog(
        'WEBAUTHN_ASSERTION_VERIFIEE',
        `Jeton biométrique testé avec succès via ${assertion.biometricMethod}`,
        {
          status: 'SUCCESS',
          actionType: 'REGISTER_AUTHENTICATOR',
          actionTitle: targetAction.title,
          targetResource: targetAction.targetResource,
          severity: targetAction.severity,
          biometricMethod: assertion.biometricMethod,
          authenticatorType: assertion.biometricMethod.includes('YubiKey') ? 'SECURITY_KEY' : 'PLATFORM',
          userVerification: 'VERIFIED',
          credentialId: assertion.credentialId,
          flags: {
            userPresent: true,
            userVerified: true,
            backupEligible: true,
            backupState: false
          },
          signaturePreview: (assertion.signatureHex || '3045022100...').substring(0, 32) + '...'
        }
      );
      showToast(`Authentificateur FIDO2 (${assertion.biometricMethod}) vérifié avec succès.`);
    });
  };

  // Simulation explicite d'un échec d'assertion biométrique (rejet utilisateur ou timeout)
  const handleSimulateBiometricFailure = async () => {
    cyberAudio.playShieldBlock();
    await appendAuditLog(
      'UNAUTHORIZED_ACCESS_FIDO2',
      `Échec assertion WebAuthn : Rejet matériel par l'utilisateur ou timeout capteur pour l'agent ${currentUser.matricule}`,
      {
        status: 'FAILURE',
        actionType: 'EXPORT_AUDIT_WORM',
        actionTitle: 'Tentative d\'Extraction Registre WORM non autorisée',
        targetResource: `Registre WORM (${auditLogs.length} blocs scellés Merkle)`,
        severity: 'CRITIQUE',
        biometricMethod: 'WebAuthn / FIDO2 (Échec assertion)',
        authenticatorType: 'PLATFORM',
        userVerification: 'FAILED',
        credentialId: currentUser.fingerprintFIDO,
        flags: {
          userPresent: true,
          userVerified: false,
          backupEligible: true,
          backupState: false
        },
        signaturePreview: '00000000000000000000000000000000 (SIGNATURE_REJETÉE)',
        failureReason: 'L\'utilisateur a annulé la demande de vérification biométrique ou le délai d\'attente a expiré.',
        mitigationKEDB: 'KEDB-042'
      }
    );
    showToast('Simulation d\'échec biométrique injectée dans le registre d\'audit WORM.');
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* 1. Filigrane médico-légal dynamique anti-capture */}
      <ForensicWatermark user={currentUser} enabled={watermarkEnabled} />

      {/* 2. En-tête Institutionnel Souverain */}
      <Header
        currentUser={currentUser}
        onRoleChange={handleRoleChange}
        onOpenSpecs={() => setIsArchitectureOpen(true)}
        onOpenOwasp={() => setIsOwaspModalOpen(true)}
        onOpenMegaPrompt={() => setIsMegaPromptOpen(true)}
        onOpenWebAuthn={handleOpenWebAuthnDirectly}
        onShredKeys={handleShredKeys}
        watermarkEnabled={watermarkEnabled}
        onToggleWatermark={() => setWatermarkEnabled(!watermarkEnabled)}
        activeView={activeView}
        onChangeView={setActiveView}
        wsStatus={wsStatus}
        wsLatencyMs={wsLatencyMs}
        onlineAgentsCount={onlineAgentsCount}
      />

      {/* 3. Toast de Notification Système */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 bg-slate-900 border border-amber-500/80 text-amber-200 px-4 py-2.5 rounded-lg shadow-2xl text-xs font-mono flex items-center space-x-2 animate-bounce"
        >
          <div className="w-2 h-2 rounded-full bg-amber-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 4. Corps Principal : Switchable Bento Grid 360° ou Split-Screen E2EE/ITSM */}
      {activeView === 'bento' ? (
        <BentoGridDashboard
          currentUser={currentUser}
          activeChannel={activeChannel}
          messages={messagesByChannel[activeChannel.id] || []}
          tickets={tickets}
          auditLogs={auditLogs}
          sessionKeyFingerprint={sessionKeyFingerprint}
          onSendMessage={(text) => handleSendMessage(text, 24)}
          onOpenOwaspModal={() => setIsOwaspModalOpen(true)}
          onOpenSpecsModal={() => setIsArchitectureOpen(true)}
          onRunDiagnostic={handleRunBotDiagnostic}
          rateLimiter={rateLimiter}
          onSwitchToSplitView={() => setActiveView('split')}
          onOpenNewTicket={() => setIsNewTicketOpen(true)}
          onEmergencyAlert48h={handleEmergencyAlert48h}
          onUpdateTicketStatus={(ticketId, status) => handleUpdateTicketStatus(ticketId, status)}
          onResolveTicket={(ticketId) => handleResolveTicket(ticketId)}
          onOpenMegaPrompt={(idea) => {
            if (idea) setMegaPromptProjectIdea(idea);
            setIsMegaPromptOpen(true);
          }}
          onOpenWebAuthn={handleOpenWebAuthnDirectly}
          onDownloadWormAudit={handleDownloadWormAudit}
          onRateLimitBlocked={() => {
            appendAuditLog('RATE_LIMIT_BLOCKED', 'Dépassement du seuil de débit Token Bucket détecté par le WAF (0/10 jetons)');
          }}
          onSimulateRepetitiveAttack={handleSimulateRepetitiveAttack}
          wsStatus={wsStatus}
          wsLatencyMs={wsLatencyMs}
          onlineAgentsCount={onlineAgentsCount}
        />
      ) : (
        <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative z-20">
          {/* Section Gauche : Messagerie Chiffrée E2EE Zero-Knowledge */}
          <ChatPane
            channels={channels}
            activeChannel={activeChannel}
            onSelectChannel={setActiveChannel}
            messages={messagesByChannel[activeChannel.id] || []}
            currentUser={currentUser}
            onSendMessage={handleSendMessage}
            onConvertToIncident={(msg) => setConvertingMessage(msg)}
            sessionKeyFingerprint={sessionKeyFingerprint}
            wsStatus={wsStatus}
            wsLatencyMs={wsLatencyMs}
            onlineAgentsCount={onlineAgentsCount}
          />

          {/* Section Droite : ITSM ITIL v4, SLA, Bot SI & Audit WORM & Événements Biométriques */}
          <ItsmPane
            tickets={tickets}
            onOpenNewTicket={() => setIsNewTicketOpen(true)}
            onSelectTicket={(t) => setSelectedTicketForDetail(t)}
            onResolveTicket={handleResolveTicket}
            botMessages={botMessages}
            onSendBotPrompt={handleSendBotPrompt}
            onRunBotDiagnostic={handleRunBotDiagnostic}
            auditLogs={auditLogs}
            onExportAuditLogs={handleDownloadWormAudit}
            onEmergencyAlert48h={handleEmergencyAlert48h}
            onTriggerBiometricTest={() => handleOpenWebAuthnDirectly()}
            onSimulateBiometricFailure={handleSimulateBiometricFailure}
          />
        </main>
      )}

      {/* 5. Modals Applicatives */}
      <ConvertIncidentModal
        message={convertingMessage}
        onClose={() => setConvertingMessage(null)}
        onConfirm={handleConfirmConvertIncident}
      />

      <NewTicketModal
        isOpen={isNewTicketOpen}
        onClose={() => setIsNewTicketOpen(false)}
        currentUser={currentUser}
        onCreate={handleCreateManualTicket}
      />

      <TicketDetailModal
        ticket={selectedTicketForDetail}
        onClose={() => setSelectedTicketForDetail(null)}
        onUpdateStatus={handleUpdateTicketStatus}
      />

      <ArchitectureModal
        isOpen={isArchitectureOpen}
        onClose={() => setIsArchitectureOpen(false)}
      />

      <OwaspMatrixModal
        isOpen={isOwaspModalOpen}
        onClose={() => setIsOwaspModalOpen(false)}
        rateLimiter={rateLimiter}
      />

      <MegaPromptModal
        isOpen={isMegaPromptOpen}
        onClose={() => setIsMegaPromptOpen(false)}
        initialProjectName={megaPromptProjectIdea}
        activeAccent={activeAccent}
        onChangeAccent={setActiveAccent}
      />

      <WebAuthnModal
        isOpen={Boolean(webAuthnAction)}
        onClose={() => {
          setWebAuthnAction(null);
          setPendingAuthorizedCallback(null);
        }}
        action={webAuthnAction}
        currentUser={currentUser}
        onAuthorized={async (assertion) => {
          if (pendingAuthorizedCallback) {
            await pendingAuthorizedCallback(assertion);
          }
          setWebAuthnAction(null);
          setPendingAuthorizedCallback(null);
        }}
        onFailedAuth={(action, reason) => {
          appendAuditLog(
            'UNAUTHORIZED_ACCESS_FIDO2',
            `Échec d'authentification biométrique pour ${action.title} : ${reason}`,
            {
              status: 'FAILURE',
              actionType: action.type,
              actionTitle: action.title,
              targetResource: action.targetResource,
              severity: action.severity,
              biometricMethod: 'WebAuthn / FIDO2 (Échec assertion)',
              authenticatorType: 'PLATFORM',
              userVerification: 'FAILED',
              credentialId: currentUser.fingerprintFIDO,
              flags: {
                userPresent: true,
                userVerified: false,
                backupEligible: true,
                backupState: false
              },
              signaturePreview: '00000000000000000000000000000000 (SIGNATURE_REJETÉE)',
              failureReason: reason,
              mitigationKEDB: 'KEDB-042'
            }
          );
        }}
      />
    </div>
  );
}
