import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Sparkles,
  Copy,
  Check,
  FileCode,
  Shield,
  Layers,
  Terminal,
  Lock,
  Zap,
  Cpu,
  Palette,
  ExternalLink,
  Code2
} from 'lucide-react';
import { cyberAudio } from '../utils/audio';

interface MegaPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialProjectName?: string;
  activeAccent: 'cyan' | 'purple' | 'emerald' | 'amber';
  onChangeAccent: (accent: 'cyan' | 'purple' | 'emerald' | 'amber') => void;
}

export const MegaPromptModal: React.FC<MegaPromptModalProps> = ({
  isOpen,
  onClose,
  initialProjectName = "Plateforme d'Investigation Financière Souveraine (E2EE Zero-Knowledge + ITSM ITIL v4)",
  activeAccent,
  onChangeAccent
}) => {
  const [projectName, setProjectName] = useState(initialProjectName);
  const [activeTab, setActiveTab] = useState<'overview' | 'tree' | 'security' | 'components' | 'prompt'>('overview');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (text: string, key: string) => {
    cyberAudio.playCryptoBip();
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const generatedPrompt = `Agis en tant qu'Architecte Logiciel Senior, Expert en Cybersécurité et Designer UI/UX primé (type Awwwards). Ton objectif est de concevoir et de coder une application web de pointe pour le projet suivant : ${projectName}.

1. Design UI/UX Ultra-Moderne (Dernier Cri) :
- Esthétique : Bento Grid avec effets de Glassmorphism (verre dépoli, flou d'arrière-plan). Dark Mode élégant avec accents néon (${activeAccent === 'cyan' ? 'Bleu Cyan' : activeAccent === 'purple' ? 'Violet Électrique' : activeAccent === 'emerald' ? 'Émeraude Cyber' : 'Ambre Régalien'}).
- Composants : Glow effects, bordures fines semi-transparentes, typographie audacieuse (Plus Jakarta Sans & JetBrains Mono).
- Outils : Tailwind CSS v4.

2. Animations Époustouflantes & Fluides :
- Micro-interactions tactiles sur chaque bouton et carte.
- Transitions Framer Motion avec stagger effects et transitions de page fluides.

3. Sécurité Puissante & Inviolable (Niveau Bancaire) :
- Standards stricts OWASP (protection anti-XSS, anti-SQLi, anti-CSRF).
- Authentification FIDO2 / OAuth 2.0 / JWT HTTP-Only + hachage Argon2/bcrypt.
- Validation Zod intraitable côté client ET serveur.
- Rate Limiting Token Bucket résilient contre bruteforce et DDoS.

4. Livrables Attendus :
Fournis le code structuré, modulaire et prêt pour la production avec l'arborescence des fichiers, les composants UI clés et l'architecture de sécurité.`;

  const fileTree = `📁 ${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}/
├── 📄 package.json              # Dépendances modernes (React 19, Motion, Lucide, Zod, Tailwind v4)
├── 📄 tsconfig.json              # Typage TypeScript strict (ES2022, bundler)
├── 📄 vite.config.ts             # Bundler Vite ultra-rapide avec alias '@'
├── 📄 index.html                 # Entry point HTML5 avec typographies modernes
│
├── 📁 src/
│   ├── 📄 main.tsx               # Point de montage React 19
│   ├── 📄 App.tsx                # Coordinateur d'état central & passerelle sécurisée
│   ├── 📄 index.css              # Thème Tailwind v4 + Glassmorphism + protection anti-print
│   │
│   ├── 📁 types/
│   │   └── 📄 index.ts           # Modèles de données (Utilisateurs, Habilitations, Tickets, Audit)
│   │
│   ├── 📁 utils/
│   │   ├── 📄 crypto.ts          # Moteur Web Crypto API (AES-256-GCM, SHA-256, Merkle Leaf)
│   │   ├── 📄 validation.ts      # Schémas Zod anti-XSS, anti-SQLi et sanitisation
│   │   ├── 📄 rateLimiter.ts     # Algorithme Token Bucket résilient (Capacité 10, 2 req/s)
│   │   ├── 📄 sanitizer.ts       # Caviardage automatique des PII et comptes bancaires
│   │   └── 📄 audio.ts           # Synthétiseur Web Audio API pour micro-interactions tactiles
│   │
│   ├── 📁 components/
│   │   ├── 📄 Header.tsx         # En-tête institutionnel, sélecteur d'habilitation et horloge RFC 3161
│   │   ├── 📄 BentoGridDashboard.tsx # Cockpit 360° Bento Grid Awwwards avec télémétrie live
│   │   ├── 📄 ChatPane.tsx       # Messagerie E2EE chiffrée avec barrière Zero-Knowledge
│   │   ├── 📄 ItsmPane.tsx       # Service Desk ITIL v4, SLA dynamiques et bot diagnostic
│   │   ├── 📄 ConvertIncidentModal.tsx # Passerelle de décontamination PII vers incident ITSM
│   │   ├── 📄 OwaspMatrixModal.tsx # Matrice OWASP Top 10 + banc d'essai interactif
│   │   ├── 📄 ArchitectureModal.tsx # Spécifications backend Go, PostgreSQL RLS & Kubernetes
│   │   └── 📄 ForensicWatermark.tsx # Filigrane médico-légal dynamique anti-capture d'écran
│   │
│   └── 📁 data/
│       ├── 📄 initialData.ts     # Jeux de données d'accréditation, canaux et tickets initiaux
│       └── 📄 sovereignSpecs.ts  # Code source Go JetStream, SQL durci et YAML K8s
│
└── 📁 backend/ (Production Ready)
    ├── 📄 main.go                # Relais Zero-Knowledge souverain NATS JetStream (Go 1.22)
    ├── 📄 init_db.sql            # Schéma PostgreSQL 16+ durci avec Row-Level Security (RLS)
    └── 📄 k8s-deployment.yaml    # Manifestes Kubernetes durcis (seccomp, non-root, ingress TLS)`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-megaprompt-title"
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-6 backdrop-blur-md animate-fadeIn"
    >
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* En-tête de la Modal */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-950/80">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-purple-600 to-cyan-600 text-white shadow-[0_0_15px_rgba(147,51,234,0.4)]">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 id="modal-megaprompt-title" className="text-sm sm:text-base font-bold text-white flex items-center space-x-2">
                <span>Studio d'Architecture & Méga-Prompt Awwwards</span>
                <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-800 px-2 py-0.5 rounded font-mono font-semibold">
                  GÉNÉRATEUR DE BLUEPRINT
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Spécifications de pointe : Bento Grid, Glassmorphism, Framer Motion, Sécurité Bancaire OWASP & Code de Production.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            title="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Barre de Configuration du Projet */}
        <div className="p-4 bg-slate-950/60 border-b border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
          <div className="flex-1 flex items-center space-x-2">
            <label className="text-xs font-mono text-slate-400 whitespace-nowrap">Projet Actif :</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 focus:border-purple-400 rounded-xl px-3 py-1.5 text-xs text-white font-mono focus:outline-none transition-colors"
              placeholder="Saisissez le nom ou l'idée de votre application..."
            />
          </div>

          {/* Palette Accent Switcher */}
          <div className="flex items-center space-x-2 bg-slate-900/90 border border-slate-800 p-1 rounded-xl">
            <Palette className="w-3.5 h-3.5 text-slate-400 ml-1.5" />
            <span className="text-[11px] font-mono text-slate-400">Accent :</span>
            <button
              onClick={() => {
                cyberAudio.playTacticalClick();
                onChangeAccent('cyan');
              }}
              className={`w-5 h-5 rounded-lg bg-cyan-500 transition-transform ${activeAccent === 'cyan' ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'}`}
              title="Bleu Cyan Néon"
            />
            <button
              onClick={() => {
                cyberAudio.playTacticalClick();
                onChangeAccent('purple');
              }}
              className={`w-5 h-5 rounded-lg bg-purple-500 transition-transform ${activeAccent === 'purple' ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'}`}
              title="Violet Électrique"
            />
            <button
              onClick={() => {
                cyberAudio.playTacticalClick();
                onChangeAccent('emerald');
              }}
              className={`w-5 h-5 rounded-lg bg-emerald-500 transition-transform ${activeAccent === 'emerald' ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'}`}
              title="Émeraude Cyber"
            />
            <button
              onClick={() => {
                cyberAudio.playTacticalClick();
                onChangeAccent('amber');
              }}
              className={`w-5 h-5 rounded-lg bg-amber-500 transition-transform ${activeAccent === 'amber' ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'}`}
              title="Ambre Régalien"
            />
          </div>
        </div>

        {/* Onglets de navigation */}
        <div className="px-4 py-2 border-b border-slate-800 flex items-center space-x-2 bg-slate-950/40 text-xs font-mono shrink-0 overflow-x-auto">
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              setActiveTab('overview');
            }}
            className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-colors ${
              activeTab === 'overview' ? 'bg-purple-950 text-purple-300 font-bold border border-purple-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>1. Architecture Globale</span>
          </button>
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              setActiveTab('tree');
            }}
            className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-colors ${
              activeTab === 'tree' ? 'bg-purple-950 text-purple-300 font-bold border border-purple-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>2. Arborescence des Fichiers</span>
          </button>
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              setActiveTab('security');
            }}
            className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-colors ${
              activeTab === 'security' ? 'bg-purple-950 text-purple-300 font-bold border border-purple-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>3. Sécurité Bancaire OWASP</span>
          </button>
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              setActiveTab('components');
            }}
            className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-colors ${
              activeTab === 'components' ? 'bg-purple-950 text-purple-300 font-bold border border-purple-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>4. Composants Bento UI</span>
          </button>
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              setActiveTab('prompt');
            }}
            className={`px-3 py-1.5 rounded-lg flex items-center space-x-1.5 transition-colors ${
              activeTab === 'prompt' ? 'bg-purple-950 text-purple-300 font-bold border border-purple-800' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>5. Méga-Prompt Exportable</span>
          </button>
        </div>

        {/* Corps des onglets */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-[#080d19] font-sans text-slate-200 space-y-4">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-r from-purple-950/40 via-slate-900 to-cyan-950/40 border border-purple-800/60 rounded-xl space-y-2">
                <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  <span>Conception d'Élite pour : {projectName}</span>
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Cette architecture allie l'esthétique primée Awwwards (Bento Grid 360°, Glassmorphism ultra-fin, micro-interactions tactiles au format 60-30-10) et la rigueur de sécurité bancaire requise par les institutions financières régulatrices (OWASP Top 10, hachage Argon2id, tokens JWT HTTP-Only, algorithme Token Bucket et validation Zod intraitable).
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center space-x-2 text-cyan-400">
                    <Layers className="w-4 h-4" />
                    <h4 className="font-bold text-xs">1. UI Bento Grid</h4>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Disposition asymétrique équilibrée, cartes surélevées à verre dépoli (<code className="text-cyan-300">backdrop-blur-2xl</code>), typographie moderne (Plus Jakarta Sans).
                  </p>
                </div>

                <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center space-x-2 text-emerald-400">
                    <Zap className="w-4 h-4" />
                    <h4 className="font-bold text-xs">2. Animations Tactiles</h4>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Framer Motion avec orchestration <code className="text-emerald-300">staggerChildren</code>, retours haptiques / sonores Web Audio natifs et zéro coupure de navigation.
                  </p>
                </div>

                <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center space-x-2 text-purple-400">
                    <Shield className="w-4 h-4" />
                    <h4 className="font-bold text-xs">3. Sécurité Bancaire</h4>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Chiffrement AES-256-GCM natif, contrôle d'accès RBAC/ABAC sur 5 niveaux, barrière Zero-Knowledge et audit scellé Merkle WORM RFC 3161.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="font-bold text-white">Stack Technologique Recommandée :</span>
                  <span className="text-[10px] text-emerald-400">100% PRODUCTION-READY</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Frontend</div>
                    <div className="font-bold text-cyan-400">React 19 + TypeScript</div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Design</div>
                    <div className="font-bold text-purple-400">Tailwind v4 + Motion</div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Sécurité</div>
                    <div className="font-bold text-emerald-400">Zod + Web Crypto API</div>
                  </div>
                  <div className="p-2 rounded bg-slate-900 border border-slate-800">
                    <div className="text-slate-500">Backend / Data</div>
                    <div className="font-bold text-amber-400">Go 1.22 + Postgres RLS</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tree' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400">
                  Arborescence complète modulaire pour {projectName} :
                </span>
                <button
                  onClick={() => handleCopy(fileTree, 'tree')}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-mono flex items-center space-x-1.5 transition-colors"
                >
                  {copiedKey === 'tree' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'tree' ? 'Arborescence Copiée !' : 'Copier l\'Arborescence'}</span>
                </button>
              </div>
              <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed selection:bg-purple-900">
                {fileTree}
              </pre>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4 text-xs font-mono">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <h4 className="font-bold text-white text-sm flex items-center space-x-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span>Blindage de Sécurité Bancaire (OWASP Top 10)</span>
                </h4>
                <div className="space-y-2 text-slate-300">
                  <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-emerald-400 font-bold">1. A01: Broken Access Control :</span> Implémentation de la barrière Zero-Knowledge stricte (les administrateurs SSI niveau 3 ont interdiction d'accéder aux données confidentielles ou financières en clair).
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-cyan-400 font-bold">2. A02: Cryptographic Failures :</span> Chiffrement AES-256-GCM via Web Crypto API natif avec vecteur d'initialisation unique (IV 96-bit) et Tag d'authentification 128-bit.
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-amber-400 font-bold">3. A03: Injection (SQL / XSS) :</span> Validation systématique via schémas Zod stricts interceptant les balises HTML malveillantes, les gestionnaires inline (<code className="text-red-300">onerror=</code>) et les requêtes SQL malveillantes (<code className="text-red-300">UNION SELECT</code>).
                  </div>
                  <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                    <span className="text-purple-400 font-bold">4. A04: Insecure Design & Rate Limiting :</span> Algorithme Token Bucket protégeant chaque point de terminaison contre les attaques par force brute ou déni de service (DDoS).
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'components' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2 text-xs">
                <h4 className="font-bold text-white text-sm flex items-center space-x-2">
                  <Code2 className="w-4 h-4 text-cyan-400" />
                  <span>Composant Bento Grid & Micro-Interactions (Motion)</span>
                </h4>
                <p className="text-slate-400">
                  Extrait de code modulaire utilisant Tailwind CSS v4 et Motion pour reproduire le cockpit Awwwards :
                </p>
                <pre className="p-3 bg-slate-900 border border-slate-800 rounded-lg font-mono text-[11px] text-cyan-200 overflow-x-auto">
{`// Carte Bento Grid Awwwards avec Glassmorphism et Glow Effect
export const BentoCard = ({ title, value, icon: Icon, badge }) => (
  <motion.div
    whileHover={{ y: -3, transition: { duration: 0.15 } }}
    className="backdrop-blur-2xl bg-slate-900/40 border border-slate-700/50 hover:border-cyan-500/50 p-4 rounded-2xl shadow-xl space-y-3 relative overflow-hidden transition-all group"
  >
    <div className="absolute -top-12 -right-12 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-cyan-500/20 transition-all" />
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2.5">
        <div className="p-2.5 rounded-xl bg-cyan-950/80 border border-cyan-800 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
          <Icon className="w-5 h-5" />
        </div>
        <h3 className="font-bold text-xs text-white uppercase tracking-wider">{title}</h3>
      </div>
      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">{badge}</span>
    </div>
    <div className="text-xl font-bold font-mono text-cyan-400">{value}</div>
  </motion.div>
);`}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'prompt' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-slate-400">
                  Méga-Prompt contextualisé prêt à copier dans n'importe quel LLM :
                </span>
                <button
                  onClick={() => handleCopy(generatedPrompt, 'prompt')}
                  className="px-3.5 py-1.5 bg-purple-700 hover:bg-purple-600 text-white rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)]"
                >
                  {copiedKey === 'prompt' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === 'prompt' ? 'Prompt Copié !' : 'Copier le Méga-Prompt'}</span>
                </button>
              </div>
              <textarea
                readOnly
                rows={14}
                value={generatedPrompt}
                className="w-full p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-purple-200 focus:outline-none selection:bg-purple-900 resize-none leading-relaxed"
              />
            </div>
          )}
        </div>

        {/* Pied de la modal */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between shrink-0">
          <span className="text-xs font-mono text-slate-400">
            Conçu selon les standards OWASP Top 10 & Awwwards • Production Ready
          </span>
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              onClose();
            }}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-mono transition-colors"
          >
            Fermer le Studio
          </button>
        </div>
      </div>
    </div>
  );
};
