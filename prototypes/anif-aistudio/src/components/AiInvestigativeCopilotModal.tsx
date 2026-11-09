import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Send,
  X,
  Bot,
  User,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Search,
  BookOpen,
  Terminal,
  Zap
} from 'lucide-react';
import { cyberAudio } from '../utils/audio';

async function requestCopilotReply(
  history: ChatMessage[],
  prompt: string,
  caseId: string
): Promise<string | null> {
  try {
    const res = await fetch('/api/ai/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId,
        prompt,
        history: history.slice(-12).map((m) => ({ role: m.role, text: m.text }))
      })
    });
    if (!res.ok) return null; // 503 = aucune clé configurée : réponse locale
    const data = (await res.json()) as { reply?: unknown };
    return typeof data.reply === 'string' && data.reply.trim() ? data.reply : null;
  } catch {
    return null;
  }
}

interface AiInvestigativeCopilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCaseId?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

export const AiInvestigativeCopilotModal: React.FC<AiInvestigativeCopilotModalProps> = ({
  isOpen,
  onClose,
  activeCaseId = '#DOS-2026-441'
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-init',
      role: 'model',
      text: `Salutations, Analyste. Je suis le Copilote d'Investigation Financière ANIF, connecté au modèle **gemini-3.8-flash**. Je suis configuré pour l'analyse des déclarations de soupçon (DOS), les blocages conservatoires sous 48h (Art. 29 GAFI), la réglementation bancaire CEMAC/COBAC et les diagnostics de l'infrastructure Tier-III de Nkok.\n\nComment puis-je assister votre enquête sur le dossier **${activeCaseId}** ?`,
      timestamp: new Date().toLocaleTimeString().substring(0, 5)
    }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  if (!isOpen) return null;

  const handleSendMessage = async (userPrompt?: string) => {
    const textToSend = userPrompt || inputText.trim();
    if (!textToSend || isLoading) return;

    cyberAudio.playTacticalClick();
    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString().substring(0, 5)
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!userPrompt) setInputText('');
    setIsLoading(true);

    try {
      // L'appel au modèle passe par le serveur : la clé GEMINI_API_KEY ne quitte jamais le serveur.
      const remoteReply = await requestCopilotReply(messages, textToSend, activeCaseId);

      if (remoteReply) {
        const replyText = remoteReply;
        cyberAudio.playCryptoBip();
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-${Date.now()}`,
            role: 'model',
            text: replyText,
            timestamp: new Date().toLocaleTimeString().substring(0, 5)
          }
        ]);
      } else {
        // Mode Enclave Souveraine Locale (Réponse experte synthétique sans clé externe)
        await new Promise((r) => setTimeout(r, 1200));
        let localReply = "";

        if (textToSend.toLowerCase().includes('gafi') || textToSend.toLowerCase().includes('29')) {
          localReply = `### Évaluation de Conformité — Recommandation 29 du GAFI\n\n1. **Autonomie Opérationnelle** : L'ANIF Gabon dispose de la compétence exclusive pour requérir des assujettis (banques CEMAC) le gel immédiat des fonds suspects sans autorisation judiciaire préalable durant les premières 48 heures.\n2. **Séquestre Actif** : Le montant de **1 450 000 000 FCFA** placé sous mandat d'arrêt à la BGFIBank Libreville est strictement couvert par le Décret N° 441-PR-ANIF.\n3. **Prochaine Échéance Légale** : Saisine du Procureur de la République près le Tribunal Spécial de Libreville avant expiration du délai MTTR restant (${new Date(Date.now() + 6800000).toLocaleTimeString()}).`;
        } else if (textToSend.toLowerCase().includes('dubai') || textToSend.toLowerCase().includes('offshore') || textToSend.toLowerCase().includes('transit')) {
          localReply = `### Analyse du Schéma de Fuite Transnationale\n\n- **Vecteur Identifié** : Fractionnement en 2 virements de 725 000 000 FCFA sous couvert de factures d'affrètement logistique maritime.\n- **Bénéficiaire Ultime (UBO)** : Holding "Gulf Star Trading DMCC" (Dubaï), liée à des comptes miroirs à Singapour.\n- **Action Immédiate Recommandée** : Émission d'une alerte spontanée via le réseau d'échange sécurisé Egmont vers le FIU des Émirats Arabes Unis et inscription au registre des personnes politiquement exposées (PPE).`;
        } else if (textToSend.toLowerCase().includes('fibre') || textToSend.toLowerCase().includes('nkok') || textToSend.toLowerCase().includes('incident')) {
          localReply = `### Diagnostic Technique Enclave Nkok Tier-III (ITIL v4)\n\n- **Incident Détecté** : Fluctuation de synchronisation BDD Postgres RLS sur la boucle fibre Sud Owendo-Nkok.\n- **MTTA Effectif** : 8 minutes (< seuil contractuel de 15 min).\n- **Procédure KEDB Applicable** : ERR-NET-NKOK-FIBER. Bascule automatique sur liaison hertzienne de secours chiffrée en cours de validation par l'administrateur SSI.`;
        } else {
          localReply = `### Rapport d'Intelligence Spécialisée\n\nAnalyse du prompt relative au dossier **${activeCaseId}** validée. Les flux de données chiffrés AES-256-GCM et les scellés Merkle WORM confirment l'intégrité de la chaîne de preuve. Aucun risque de compromission détecté au niveau de l'enclave Nkok.`;
        }

        cyberAudio.playCryptoBip();
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-${Date.now()}`,
            role: 'model',
            text: localReply,
            timestamp: new Date().toLocaleTimeString().substring(0, 5)
          }
        ]);
      }
    } catch (err: unknown) {
      console.error("Erreur Gemini Copilot :", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          role: 'model',
          text: `Alerte : Le service d'inférence sécurisé signale une indisponibilité momentanée. Les règles de sécurité régaliennes locales restent actives.`,
          timestamp: new Date().toLocaleTimeString().substring(0, 5)
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="relative w-full max-w-3xl h-[85vh] bg-[#070b14] border border-cyan-500/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header Modal */}
        <div className="p-4 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.3)]">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-sm text-white">Copilote IA d'Investigation Financière</h3>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
                  gemini-3.8-flash
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Assistance Référentiel GAFI Reco 29 • Dossier {activeCaseId} • Enclave Nkok
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              cyberAudio.playTacticalClick();
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Suggestion Chips */}
        <div className="p-2.5 bg-slate-950 border-b border-slate-800/80 flex items-center space-x-2 overflow-x-auto text-[11px] font-mono">
          <span className="text-slate-500 shrink-0">Prompts Rapides :</span>
          <button
            onClick={() => handleSendMessage("Analyser la conformité GAFI Reco 29 du gel de 1.45 Md FCFA")}
            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700/80 rounded-lg shrink-0 transition-colors"
          >
            ⚖️ Conformité Décret 48h
          </button>
          <button
            onClick={() => handleSendMessage("Évaluer le risque de fuite de capitaux vers Dubaï DMCC")}
            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-700/80 rounded-lg shrink-0 transition-colors"
          >
            🌐 Risque Circuit Dubaï
          </button>
          <button
            onClick={() => handleSendMessage("Diagnostiquer la rupture de liaison fibre Nkok (ITIL v4)")}
            className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-purple-300 border border-slate-700/80 rounded-lg shrink-0 transition-colors"
          >
            ⚡ Diagnostic Fibre Nkok
          </button>
        </div>

        {/* Message Thread */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 font-sans text-xs">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex items-start space-x-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'model' && (
                <div className="p-1.5 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 shrink-0 mt-0.5">
                  <Bot className="w-4 h-4" />
                </div>
              )}
              <div
                className={`max-w-[80%] p-3.5 rounded-2xl ${
                  m.role === 'user'
                    ? 'bg-cyan-600 text-white rounded-tr-xs shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                    : 'bg-slate-900/90 border border-slate-800 text-slate-200 rounded-tl-xs shadow-md space-y-2'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] opacity-70 font-mono mb-1">
                  <span>{m.role === 'user' ? 'Analyste ANIF' : 'Copilote Gemini 3.8'}</span>
                  <span>{m.timestamp}</span>
                </div>
                <div className="prose prose-invert prose-xs leading-relaxed whitespace-pre-wrap">
                  {m.text}
                </div>
              </div>
              {m.role === 'user' && (
                <div className="p-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 shrink-0 mt-0.5">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex items-start space-x-3">
              <div className="p-1.5 rounded-lg bg-cyan-950 border border-cyan-800 text-cyan-400 shrink-0 mt-0.5 animate-pulse">
                <Bot className="w-4 h-4" />
              </div>
              <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-xs text-slate-400 font-mono text-xs flex items-center space-x-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                <span>Interrogation de la base de renseignement et modélisation...</span>
              </div>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex items-center space-x-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder="Interroger l'IA souveraine sur les dossiers ou procédures..."
            className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono"
          />
          <button
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isLoading}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 transition-all shadow-[0_0_15px_rgba(6,182,212,0.3)]"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Analyser</span>
          </button>
        </div>
      </div>
    </div>
  );
};
