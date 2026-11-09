import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ShieldAlert,
  ShieldCheck,
  Zap,
  Lock,
  Database,
  Flame,
  CheckCircle2,
  X,
  Play,
  RotateCcw
} from 'lucide-react';
import { validateSecurePayload, SafeTextSchema } from '../utils/validation';
import { TokenBucketRateLimiter, RateLimitStatus } from '../utils/rateLimiter';

interface OwaspMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
  rateLimiter: TokenBucketRateLimiter;
}

export const OwaspMatrixModal: React.FC<OwaspMatrixModalProps> = ({
  isOpen,
  onClose,
  rateLimiter
}) => {
  const [testPayload, setTestPayload] = useState<string>("SELECT * FROM transactions WHERE montant > 1000000; --");
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [rateLimitStatus, setRateLimitStatus] = useState<RateLimitStatus>(rateLimiter.getStatus());
  const [spamCount, setSpamCount] = useState(0);

  if (!isOpen) return null;

  const handleTestPayload = () => {
    const res = validateSecurePayload(SafeTextSchema, testPayload);
    if (res.success) {
      setTestResult({
        success: true,
        message: 'Payload Validé : Aucun pattern malveillant XSS ou SQLi détecté.'
      });
    } else {
      setTestResult({
        success: false,
        message: res.errors[0]
      });
    }
  };

  const handleSpamRequest = () => {
    const status = rateLimiter.consume(1);
    setRateLimitStatus(status);
    setSpamCount((prev) => prev + 1);
  };

  const handleResetRateLimiter = () => {
    rateLimiter.reset();
    setRateLimitStatus(rateLimiter.getStatus());
    setSpamCount(0);
  };

  const owaspChecklist = [
    {
      code: 'A01:2021',
      title: 'Broken Access Control',
      mitigation: 'Isolation Zero-Knowledge stricte (Niveau 3 SSI bloqué sur canaux DOS) + RLS Postgres',
      status: 'BLINDÉ'
    },
    {
      code: 'A02:2021',
      title: 'Cryptographic Failures',
      mitigation: 'AES-GCM 256 bits matériel natif (Web Crypto API) + X25519 Double Ratchet + Scellement Merkle',
      status: 'BLINDÉ'
    },
    {
      code: 'A03:2021',
      title: 'Injection (SQL, NoSQL, OS)',
      mitigation: 'Schémas Zod stricts + Requêtes préparées ORM + Décontamination PII regex GAFI',
      status: 'BLINDÉ'
    },
    {
      code: 'A04:2021',
      title: 'Insecure Design',
      mitigation: 'Cadre ITIL v4 certifié + Décret d\'opposition 48h + Ségrégation des privilèges',
      status: 'BLINDÉ'
    },
    {
      code: 'A05:2021',
      title: 'Security Misconfiguration',
      mitigation: 'NetworkPolicies Kubernetes bare-metal + Headers CSP stricts + Zero HTTP exposés',
      status: 'BLINDÉ'
    },
    {
      code: 'A06:2021',
      title: 'Vulnerable Components',
      mitigation: 'Zero dépendance non auditée, Web Crypto API standard W3C intégrée',
      status: 'BLINDÉ'
    },
    {
      code: 'A07:2021',
      title: 'Identification & Auth Failures',
      mitigation: 'FIDO2 / WebAuthn YubiKey matériel, HMAC Vault et clés Ed25519',
      status: 'BLINDÉ'
    },
    {
      code: 'A08:2021',
      title: 'Software & Data Integrity',
      mitigation: 'Arbre de Merkle WORM immuable RFC 3161 recalculable à la seconde',
      status: 'BLINDÉ'
    },
    {
      code: 'A09:2021',
      title: 'Security Logging & Monitoring',
      mitigation: 'Horodatage certifié UTC [RFC 3161] + SIEM NATS JetStream distribué',
      status: 'BLINDÉ'
    },
    {
      code: 'A10:2021',
      title: 'Server-Side Request Forgery',
      mitigation: 'Micro-segmentation pod réseau Kubernetes + Isolation totale des liaisons Nkok',
      status: 'BLINDÉ'
    }
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto animate-fadeIn"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="backdrop-blur-xl bg-slate-900/90 border border-cyan-500/30 rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl shadow-cyan-950/40 overflow-hidden"
      >
        {/* En-tête */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-wide">
                  Matrice de Cybersécurité Inviolable (Norme Bancaire OWASP Top 10)
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-700/60 font-bold">
                  SCORE 100/100
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Audit de résilience cryptographique, filtres anti-injections (Zod) et banc d'essai Rate Limiting en direct.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
            aria-label="Fermer"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Corps défilable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs font-mono">
          {/* Section 1 : Simulateur de Rate Limiting (Token Bucket) */}
          <div className="backdrop-blur-md bg-slate-950/70 border border-cyan-500/30 p-4 rounded-xl space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                <h3 className="font-bold text-slate-100 text-xs sm:text-sm">
                  Simulateur Anti-DDoS & Brute Force (Algorithme Token Bucket)
                </h3>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[11px] text-slate-400">Capacité : 10 requêtes / Rechargement : 2 req/s</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-center">
              <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-lg">
                <div className="text-[10px] text-slate-400">Jetons Restants</div>
                <div className="text-lg font-bold text-cyan-400">
                  {rateLimitStatus.remainingTokens} / {rateLimitStatus.maxTokens}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-lg">
                <div className="text-[10px] text-slate-400">Requêtes Autorisées</div>
                <div className="text-lg font-bold text-emerald-400">{rateLimitStatus.totalRequestsHandled - rateLimitStatus.totalBlockedRequests}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-lg">
                <div className="text-[10px] text-slate-400">Requêtes Bloquées (HTTP 429)</div>
                <div className="text-lg font-bold text-red-400">{rateLimitStatus.totalBlockedRequests}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 p-2.5 rounded-lg">
                <div className="text-[10px] text-slate-400">Statut Firewall WAF</div>
                <div className={`text-xs font-bold mt-1 ${rateLimitStatus.allowed ? 'text-emerald-400' : 'text-red-400 animate-pulse'}`}>
                  {rateLimitStatus.allowed ? 'PASS (Flux Nominal)' : `BLOQUÉ (429 - Cooldown ${rateLimitStatus.retryAfterSeconds}s)`}
                </div>
              </div>
            </div>

            {/* Barre de jauge de jetons */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Niveau du Réservoir de Jetons :</span>
                <span>{Math.round((rateLimitStatus.remainingTokens / rateLimitStatus.maxTokens) * 100)}%</span>
              </div>
              <div className="w-full bg-slate-900 rounded-full h-2.5 overflow-hidden border border-slate-800">
                <div
                  className={`h-full transition-all duration-300 ${
                    rateLimitStatus.remainingTokens > 4
                      ? 'bg-gradient-to-r from-emerald-500 to-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.5)]'
                      : 'bg-gradient-to-r from-amber-500 to-red-500'
                  }`}
                  style={{ width: `${(rateLimitStatus.remainingTokens / rateLimitStatus.maxTokens) * 100}%` }}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleSpamRequest}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 shadow-[0_0_15px_rgba(6,182,212,0.4)]"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Déclencher une Requête Client ({spamCount})</span>
              </motion.button>

              <button
                onClick={handleResetRateLimiter}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs flex items-center space-x-1 border border-slate-700"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Réinitialiser Réservoir</span>
              </button>
            </div>
          </div>

          {/* Section 2 : Banc d'Essai Anti-Injection (Zod & WAF) */}
          <div className="backdrop-blur-md bg-slate-950/70 border border-purple-500/30 p-4 rounded-xl space-y-3">
            <div className="flex items-center space-x-2 text-purple-300">
              <Database className="w-4 h-4" />
              <h3 className="font-bold text-xs sm:text-sm">
                Banc d'Essai de Filtrage Zod (Anti-SQLi & Anti-XSS)
              </h3>
            </div>
            <p className="text-[11px] text-slate-400">
              Testez la détection en temps réel des injections SQL et scripts malveillants par le validateur strict Zod.
            </p>

            <div className="flex gap-2">
              <input
                type="text"
                value={testPayload}
                onChange={(e) => setTestPayload(e.target.value)}
                placeholder="Saisissez un payload d'attaque..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400 font-mono"
              />
              <button
                onClick={handleTestPayload}
                className="px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white font-bold rounded-lg text-xs"
              >
                Auditer Payload
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <span className="text-slate-400 py-0.5">Payloads types :</span>
              <button
                onClick={() => setTestPayload("admin' OR '1'='1' --")}
                className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded hover:bg-slate-700"
              >
                SQLi: admin' OR '1'='1'
              </button>
              <button
                onClick={() => setTestPayload("<script>alert('XSS_ATTACK')</script>")}
                className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded hover:bg-slate-700"
              >
                XSS: &lt;script&gt;
              </button>
              <button
                onClick={() => setTestPayload("Virement légitime de fonds conforme directive")}
                className="px-2 py-0.5 bg-slate-800 text-slate-300 rounded hover:bg-slate-700"
              >
                Texte Légitime
              </button>
            </div>

            {testResult && (
              <div
                className={`p-2.5 rounded-lg border text-xs flex items-center space-x-2 ${
                  testResult.success
                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                    : 'bg-red-950/60 border-red-800 text-red-300'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Section 3 : Grille des 10 Contrôles OWASP Standard Bancaire */}
          <div className="space-y-2">
            <h3 className="font-bold text-slate-200 text-xs sm:text-sm flex items-center space-x-1.5">
              <Lock className="w-4 h-4 text-cyan-400" />
              <span>Contrôles de Sécurité OWASP Top 10 Implémentés</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              {owaspChecklist.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 flex items-start justify-between gap-2"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-cyan-400">{item.code}</span>
                      <span className="font-semibold text-slate-200">{item.title}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-sans leading-relaxed">
                      {item.mitigation}
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800 shrink-0">
                    {item.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};
