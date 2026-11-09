import React, { useState } from 'react';
import {
  Lock,
  ShieldAlert,
  Send,
  Paperclip,
  Clock,
  ArrowRightCircle,
  FileCheck2,
  Binary,
  AlertTriangle
} from 'lucide-react';
import { Channel, EncryptedMessage, UserProfile } from '../types';

interface ChatPaneProps {
  channels: Channel[];
  activeChannel: Channel;
  onSelectChannel: (channel: Channel) => void;
  messages: EncryptedMessage[];
  currentUser: UserProfile;
  onSendMessage: (text: string, retentionHours: number, attachFile?: boolean) => void;
  onConvertToIncident: (message: EncryptedMessage) => void;
  sessionKeyFingerprint: string;
  wsStatus?: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  wsLatencyMs?: number;
  onlineAgentsCount?: number;
}

export const ChatPane: React.FC<ChatPaneProps> = ({
  channels,
  activeChannel,
  onSelectChannel,
  messages,
  currentUser,
  onSendMessage,
  onConvertToIncident,
  sessionKeyFingerprint,
  wsStatus = 'connected',
  wsLatencyMs = 5.2,
  onlineAgentsCount = 1
}) => {
  const [inputText, setInputText] = useState('');
  const [retention, setRetention] = useState<number>(24);
  const [showHexView, setShowHexView] = useState<Record<string, boolean>>({});
  const [attachSimulated, setAttachSimulated] = useState(false);

  // Vérification de la barrière Zero-Knowledge
  // Les administrateurs SSI (Niveau 3) ont une interdiction absolue d'accès au texte en clair des dossiers DOS
  const isZeroKnowledgeBlocked = currentUser.roleNiveau === 3 && activeChannel.type === 'dos';

  const handleSend = () => {
    if (!inputText.trim()) return;
    onSendMessage(inputText.trim(), retention, attachSimulated);
    setInputText('');
    setAttachSimulated(false);
  };

  const toggleHex = (msgId: string) => {
    setShowHexView((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  return (
    <section
      id="chat-pane"
      aria-label="Messagerie Chiffrée E2EE"
      className="flex-1 flex flex-col bg-slate-950 border-r border-slate-800 h-full overflow-hidden"
    >
      {/* 1. Barre de Sélection des Canaux */}
      <div className="bg-slate-900/90 border-b border-slate-800 p-2.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shrink-0">
        <div className="flex items-center space-x-2 overflow-x-auto max-w-full">
          {channels.map((ch) => {
            const isActive = ch.id === activeChannel.id;
            const isDos = ch.type === 'dos';
            return (
              <button
                key={ch.id}
                onClick={() => onSelectChannel(ch)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-colors whitespace-nowrap ${
                  isActive
                    ? isDos
                      ? 'bg-amber-950/60 text-amber-300 border border-amber-800/80 font-semibold'
                      : 'bg-slate-800 text-slate-100 border border-slate-700 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                {isDos ? <Lock className="w-3 h-3 text-amber-400" /> : <div className="w-2 h-2 rounded-full bg-slate-600" />}
                <span>#{ch.code}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center space-x-2 text-[11px] font-mono text-slate-400">
          <div
            id="ws-chat-sync-badge"
            className={`flex items-center space-x-1 px-2 py-0.5 rounded border ${
              wsStatus === 'connected'
                ? 'text-cyan-300 bg-cyan-950/60 border-cyan-800'
                : wsStatus === 'reconnecting'
                ? 'text-amber-300 bg-amber-950/60 border-amber-800'
                : 'text-red-300 bg-red-950/60 border-red-800'
            }`}
            title={`WebSocket DC Nkok: ${wsStatus} (${wsLatencyMs}ms, ${onlineAgentsCount} connectés)`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                wsStatus === 'connected' ? 'bg-cyan-400 animate-pulse' : 'bg-amber-400'
              }`}
            />
            <span>WS Sync ({onlineAgentsCount} agt)</span>
          </div>
          <div className="flex items-center space-x-1 text-emerald-400 bg-emerald-950/40 border border-emerald-900/60 px-2 py-0.5 rounded">
            <Lock className="w-2.5 h-2.5" />
            <span className="truncate max-w-[150px]">{activeChannel.e2eeProtocol}</span>
          </div>
        </div>
      </div>

      {/* 2. Alerte Barrière Zéro-Knowledge si Admin SSI sur Canal DOS */}
      {isZeroKnowledgeBlocked && (
        <div
          id="zk-barrier-notice"
          className="bg-amber-950/70 border-b border-amber-800 px-4 py-2 text-xs text-amber-200 flex items-start space-x-2.5 shrink-0 animate-fadeIn"
        >
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-amber-300 uppercase tracking-wide text-[11px]">
              Cloisonnement Zero-Knowledge Actif (Art. 29 GAFI)
            </div>
            <div className="text-[11px] text-amber-200/90 leading-relaxed">
              En tant qu'administrateur système (Niv 3), les clés de déchiffrement privé des dossiers d'instruction financière ne sont jamais transmises à votre enclave. Le texte en clair est masqué à la source.
            </div>
          </div>
        </div>
      )}

      {/* 3. Description & En-tête du canal actif */}
      <div className="bg-slate-900/40 border-b border-slate-800/80 px-4 py-2 flex items-center justify-between text-xs text-slate-400 shrink-0">
        <div className="flex items-center space-x-2 truncate">
          <span className="font-semibold text-slate-200 truncate">{activeChannel.nom}</span>
          <span className="text-slate-500">•</span>
          <span className="text-[11px] text-slate-400 truncate">{activeChannel.description}</span>
        </div>
        <div className="flex items-center space-x-2 font-mono text-[10px] text-slate-500 shrink-0">
          <Clock className="w-3 h-3" />
          <span>Purge: {activeChannel.retentionHours}h</span>
        </div>
      </div>

      {/* 4. Flux des Messages Chiffrés */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500 font-mono text-xs">
            <Lock className="w-8 h-8 text-slate-700 mb-2" />
            <span>Aucun message dans ce canal sécurisé.</span>
            <span>Toutes les communications sont chiffrées localement avant transit.</span>
          </div>
        ) : (
          messages.map((m) => {
            const showHex = showHexView[m.id];
            const isBlockedForThisUser = currentUser.roleNiveau === 3 && activeChannel.type === 'dos';

            return (
              <div
                key={m.id}
                className={`p-3.5 rounded-lg border transition-all ${
                  isBlockedForThisUser
                    ? 'bg-slate-950 border-red-950/60'
                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* En-tête du message */}
                <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-xs text-slate-200">{m.auteur}</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 font-mono">
                      Niv {m.roleNiveau}
                    </span>
                    <span className="text-[10px] font-mono text-amber-400/90 font-medium">
                      {m.classification}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2 font-mono text-[10px] text-slate-500">
                    <span>{m.timestampRFC3161}</span>
                  </div>
                </div>

                {/* Corps du message : Zero-Knowledge block or Plaintext */}
                <div className="my-2">
                  {isBlockedForThisUser ? (
                    <div className="bg-red-950/20 border border-red-900/40 rounded p-2.5 text-xs font-mono text-red-300 flex items-start space-x-2">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-red-400">
                          [CONTENU SCELLÉ - PRINCIPE ZERO-KNOWLEDGE]
                        </div>
                        <div className="text-[11px] text-red-300/80 mt-0.5 font-sans">
                          Clé privée restreinte aux analystes financiers et magistrats sous l'article 29. Chiffrement AES-GCM préservé.
                        </div>
                      </div>
                    </div>
                  ) : showHex ? (
                    <div className="bg-black/60 border border-slate-800 rounded p-2 text-[11px] font-mono text-emerald-400 space-y-1">
                      <div><span className="text-slate-500">IV (96-bit):</span> {m.ivHex}</div>
                      <div><span className="text-slate-500">Tag Auth (128-bit):</span> {m.tagHex}</div>
                      <div className="break-all"><span className="text-slate-500">Ciphertext Hex:</span> {m.chiffreHex}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-100 font-sans leading-relaxed break-words">
                      {m.texteClair}
                    </div>
                  )}

                  {/* Pièce jointe cryptographique si présente */}
                  {m.pieceJointe && !isBlockedForThisUser && (
                    <div className="mt-2.5 inline-flex items-center space-x-2 bg-slate-950 border border-slate-800 px-2.5 py-1.5 rounded text-[11px] font-mono text-slate-300">
                      <FileCheck2 className="w-3.5 h-3.5 text-blue-400" />
                      <span>{m.pieceJointe.nom} ({m.pieceJointe.taille})</span>
                      <span className="text-slate-500 text-[10px]">SHA-256: {m.pieceJointe.sha256.substring(0, 12)}...</span>
                    </div>
                  )}
                </div>

                {/* Barre d'actions du message */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-800/60 text-[11px] font-mono text-slate-500">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => toggleHex(m.id)}
                      className="hover:text-emerald-400 flex items-center space-x-1 text-slate-400 transition-colors"
                      title="Inspecter le payload chiffré AES-GCM"
                    >
                      <Binary className="w-3 h-3" />
                      <span>{showHex ? 'Vue Texte' : 'Vue Chiffrée Hex'}</span>
                    </button>
                    <span>•</span>
                    <span className="truncate max-w-[120px]">Tag: {m.tagHex.substring(0, 8)}...</span>
                  </div>

                  {/* Action Passerelle Chat vers ITSM */}
                  <div>
                    <button
                      onClick={() => onConvertToIncident(m)}
                      className="flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-800/80 transition-colors text-[11px]"
                      title="Transférer ce signalement vers le module ITSM avec caviardage automatique des données bancaires"
                    >
                      <ArrowRightCircle className="w-3.5 h-3.5" />
                      <span>Convertir en Incident ITSM</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 5. Zone de Saisie Sécurisée avec Chiffrement Client-Side */}
      <div className="p-3 bg-slate-900 border-t border-slate-800 shrink-0">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-2">
          <div className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-slate-300">Session X25519:</span>
            <span className="text-emerald-400">{sessionKeyFingerprint}</span>
          </div>

          <div className="flex items-center space-x-2">
            <span>Rétention éphémère :</span>
            <select
              value={retention}
              onChange={(e) => setRetention(Number(e.target.value))}
              className="bg-slate-950 text-slate-200 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] focus:outline-none"
            >
              <option value={1}>1 heure</option>
              <option value={24}>24 heures (Défaut)</option>
              <option value={48}>48 heures</option>
              <option value={168}>7 jours</option>
            </select>
          </div>
        </div>

        {attachSimulated && (
          <div className="mb-2 p-1.5 bg-blue-950/40 border border-blue-800/60 rounded text-[11px] font-mono text-blue-300 flex items-center justify-between">
            <span className="flex items-center space-x-1">
              <Paperclip className="w-3 h-3 text-blue-400" />
              <span>Pièce jointe scellée : Scelles_Financiers_BGF88.dat.enc (1.8 Mo)</span>
            </span>
            <button
              onClick={() => setAttachSimulated(false)}
              className="text-red-400 hover:text-red-300 px-1"
            >
              ×
            </button>
          </div>
        )}

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setAttachSimulated(!attachSimulated)}
            className={`p-2 rounded-lg border transition-colors ${
              attachSimulated
                ? 'bg-blue-900/60 border-blue-600 text-blue-200'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
            title="Joindre une pièce scellée chiffrée"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
            }}
            placeholder={
              isZeroKnowledgeBlocked
                ? "Canal en lecture chiffrée seule pour profil SSI..."
                : "Saisir un message chiffré de bout en bout (AES-GCM 256 bits)..."
            }
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 font-sans focus:outline-none focus:border-amber-400"
          />

          <button
            onClick={handleSend}
            disabled={!inputText.trim()}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-xs font-semibold font-mono flex items-center space-x-1.5 transition-all shadow-md"
          >
            <Send className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Chiffrer & Envoyer</span>
          </button>
        </div>
      </div>
    </section>
  );
};
