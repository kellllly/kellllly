import React, { useEffect, useState } from 'react';
import {
  Shield,
  Lock,
  Server,
  FileCode,
  Flame,
  Eye,
  KeyRound,
  CheckCircle2,
  Sparkles,
  Fingerprint
} from 'lucide-react';
import { UserProfile, AccreditationLevel } from '../types';
import { ACCREDITATION_PROFILES } from '../data/initialData';
import { SensitiveAction } from '../utils/webauthn';

interface HeaderProps {
  currentUser: UserProfile;
  onRoleChange: (level: AccreditationLevel) => void;
  onOpenSpecs: () => void;
  onOpenOwasp: () => void;
  onOpenMegaPrompt: () => void;
  onOpenWebAuthn: (action?: SensitiveAction) => void;
  onShredKeys: () => void;
  watermarkEnabled: boolean;
  onToggleWatermark: () => void;
  activeView: 'split' | 'bento';
  onChangeView: (view: 'split' | 'bento') => void;
  wsStatus?: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  wsLatencyMs?: number;
  onlineAgentsCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  onRoleChange,
  onOpenSpecs,
  onOpenOwasp,
  onOpenMegaPrompt,
  onOpenWebAuthn,
  onShredKeys,
  watermarkEnabled,
  onToggleWatermark,
  activeView,
  onChangeView,
  wsStatus = 'connected',
  wsLatencyMs = 6.2,
  onlineAgentsCount = 1
}) => {
  const [rfcClock, setRfcClock] = useState<string>('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setRfcClock(now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC');
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="relative z-40 bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex items-center justify-between text-slate-100 shadow-lg">
      {/* Zone 1: Identité Nationale & Souveraineté Nkok */}
      <div className="flex items-center space-x-3.5">
        {/* Écusson National aux couleurs du Gabon */}
        <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-b from-[#009e60] via-[#fcd116] to-[#003366] p-0.5 shadow-md shadow-emerald-950/40">
          <div className="w-full h-full bg-slate-950 rounded-[6px] flex items-center justify-center font-bold text-amber-300 text-xs tracking-wider">
            GA
          </div>
        </div>

        <div>
          <div className="flex items-center space-x-2">
            <h1 className="font-bold tracking-wide text-xs sm:text-sm text-slate-100">
              ANIF GABON <span className="font-normal text-slate-400 hidden sm:inline">| République Gabonaise</span>
            </h1>
            <span className="hidden md:inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800">
              <Server className="w-3 h-3" />
              <span>DC NKOK TIER-III</span>
            </span>
            <span className="hidden lg:inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-blue-950/80 text-blue-400 border border-blue-800">
              <Shield className="w-3 h-3" />
              <span>RECO 29 GAFI</span>
            </span>
            <span
              id="ws-header-status"
              className={`hidden sm:inline-flex items-center space-x-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${
                wsStatus === 'connected'
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80 shadow-[0_0_8px_rgba(16,185,129,0.25)]'
                  : wsStatus === 'reconnecting'
                  ? 'bg-amber-950/80 text-amber-300 border-amber-700/80'
                  : 'bg-red-950/80 text-red-300 border-red-700/80'
              }`}
              title={`Liaison WebSocket DC Nkok: ${wsStatus} (${wsLatencyMs}ms RTT, ${onlineAgentsCount} agents connectés)`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  wsStatus === 'connected'
                    ? 'bg-emerald-400 animate-pulse shadow-[0_0_6px_#34d399]'
                    : wsStatus === 'reconnecting'
                    ? 'bg-amber-400 animate-ping'
                    : 'bg-red-500'
                }`}
              />
              <span>
                {wsStatus === 'connected'
                  ? `WS LIVE (${wsLatencyMs}ms • ${onlineAgentsCount} AGT)`
                  : wsStatus === 'reconnecting'
                  ? 'WS RECONNEXION...'
                  : 'WS HORS-LIGNE'}
              </span>
            </span>
          </div>

          <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono">
            <span className="flex items-center space-x-1 text-slate-300">
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>Enclave Zero-Knowledge</span>
            </span>
            <span>•</span>
            <span className="text-emerald-400 tabular-nums">
              RFC 3161: {rfcClock}
            </span>
          </div>
        </div>
      </div>

      {/* Zone 2: Contrôles Sécurité, Specs Souveraines & Purge */}
      <div className="flex items-center space-x-3">
        {/* Sélecteur de Vue : Split-Screen ou Bento Grid */}
        <div className="hidden md:flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-700/60 font-mono text-xs">
          <button
            onClick={() => onChangeView('split')}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              activeView === 'split'
                ? 'bg-slate-800 text-cyan-300 font-bold shadow-xs'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Split-Screen
          </button>
          <button
            onClick={() => onChangeView('bento')}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              activeView === 'bento'
                ? 'bg-cyan-950/80 text-cyan-300 font-bold border border-cyan-800/80 shadow-[0_0_10px_rgba(6,182,212,0.3)]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Bento Grid 360°
          </button>
        </div>

        {/* Bouton Matrice OWASP */}
        <button
          onClick={onOpenOwasp}
          className="hidden lg:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-800/80 text-xs font-mono font-semibold transition-all shadow-[0_0_10px_rgba(6,182,212,0.2)]"
          title="Consulter la matrice de conformité OWASP Top 10 et tester le Rate Limiter"
        >
          <Shield className="w-3.5 h-3.5 text-cyan-400" />
          <span>OWASP 100%</span>
        </button>

        {/* Bouton Studio Awwwards & Méga-Prompt */}
        <button
          onClick={onOpenMegaPrompt}
          className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md bg-purple-950/70 hover:bg-purple-900/80 text-purple-300 border border-purple-800 text-xs font-mono font-semibold transition-all shadow-[0_0_10px_rgba(147,51,234,0.3)]"
          title="Ouvrir le Studio d'Architecture Awwwards et le générateur de Méga-Prompt"
        >
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span className="hidden md:inline">Studio Awwwards</span>
          <span className="md:hidden">Studio</span>
        </button>

        {/* Bouton Specs Architecture Souveraine (Go / Postgres / K8s) */}
        <button
          onClick={onOpenSpecs}
          className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono transition-colors"
          title="Consulter le code backend Go, schéma PostgreSQL RLS et manifestes Kubernetes"
        >
          <FileCode className="w-3.5 h-3.5 text-blue-400" />
          <span>Code & Specs</span>
        </button>

        {/* Bouton Toggle Filigrane Médico-Légal */}
        <button
          onClick={onToggleWatermark}
          className={`flex items-center space-x-1 px-2 py-1.5 rounded-md text-xs font-mono border transition-colors ${
            watermarkEnabled
              ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}
          title="Activer/Désactiver le filigrane médico-légal anti-capture"
        >
          <Eye className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Filigrane</span>
        </button>

        {/* Bouton Purge Cryptographique d'Urgence */}
        <button
          onClick={onShredKeys}
          className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-md bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800 text-xs font-mono font-semibold transition-colors"
          title="Effacement immédiat des clés de session en mémoire vive (Cryptographic Zeroization)"
        >
          <Flame className="w-3.5 h-3.5 text-red-400" />
          <span className="hidden sm:inline">Purge Mémoire</span>
        </button>

        {/* Zone 3: Sélecteur d'Habilitation (Niveaux 1 à 5) */}
        <div className="flex items-center pl-2 border-l border-slate-800 space-x-2">
          <div className="flex flex-col items-end">
            <div className="flex items-center space-x-1.5">
              <KeyRound className="w-3 h-3 text-amber-400" />
              <label htmlFor="role-select" className="sr-only">Habilitation</label>
              <select
                id="role-select"
                value={currentUser.roleNiveau}
                onChange={(e) => onRoleChange(Number(e.target.value) as AccreditationLevel)}
                className="bg-slate-950 text-amber-300 font-mono font-semibold text-xs rounded border border-slate-700 py-1 px-2 focus:outline-none focus:border-amber-400 cursor-pointer max-w-[200px] sm:max-w-none truncate"
              >
                {Object.values(ACCREDITATION_PROFILES).map((p) => (
                  <option key={p.roleNiveau} value={p.roleNiveau}>
                    Niv {p.roleNiveau} : {p.nom} ({p.roleLibelle.split(':')[1]?.trim() || p.titre})
                  </option>
                ))}
              </select>
            </div>
            
            <button
              onClick={() =>
                onOpenWebAuthn({
                  id: `bio-check-${Date.now()}`,
                  type: 'REGISTER_AUTHENTICATOR',
                  title: 'Gestionnaire Biométrique FIDO2 / WebAuthn',
                  description: 'Authentification forte et enrôlement de jeton matériel (Touch ID, Windows Hello, YubiKey).',
                  targetResource: currentUser.fingerprintFIDO,
                  severity: 'HAUTE'
                })
              }
              className="flex items-center space-x-1.5 text-[10px] text-slate-400 hover:text-emerald-300 font-mono mt-0.5 px-1 py-0.5 rounded hover:bg-slate-800/80 transition-colors cursor-pointer group"
              title="Gérer ou tester l'authentificateur biométrique WebAuthn / FIDO2"
            >
              <Fingerprint className="w-3 h-3 text-emerald-400 group-hover:scale-110 transition-transform" />
              <span>{currentUser.matricule}</span>
              <span>•</span>
              <span className="text-slate-300 group-hover:text-emerald-300 font-semibold">{currentUser.fingerprintFIDO}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
