import React, { useState, useEffect } from 'react';
import { ShieldCheck, AlertTriangle, ArrowRight, X } from 'lucide-react';
import { EncryptedMessage, TicketPriority } from '../types';
import { sanitizeFinancialAndPII, SanitizationResult } from '../utils/sanitizer';

interface ConvertIncidentModalProps {
  message: EncryptedMessage | null;
  onClose: () => void;
  onConfirm: (
    title: string,
    sanitizedDescription: string,
    priority: TicketPriority,
    stationId: string
  ) => void;
}

export const ConvertIncidentModal: React.FC<ConvertIncidentModalProps> = ({
  message,
  onClose,
  onConfirm
}) => {
  const [priority, setPriority] = useState<TicketPriority>('P2');
  const [stationId, setStationId] = useState('TERM-ANIF-LIB-884');
  const [sanitization, setSanitization] = useState<SanitizationResult | null>(null);

  useEffect(() => {
    if (message) {
      const res = sanitizeFinancialAndPII(message.texteClair);
      setSanitization(res);
      // Auto-escalation to P1 if urgent technical blockage mentioned
      if (
        message.texteClair.toLowerCase().includes('coupure') ||
        message.texteClair.toLowerCase().includes('blocage') ||
        message.texteClair.toLowerCase().includes('intermittente')
      ) {
        setPriority('P1');
      } else {
        setPriority('P2');
      }
    }
  }, [message]);

  if (!message || !sanitization) return null;

  const handleConfirm = () => {
    const title = sanitization.sanitizedText.substring(0, 60).replace(/\n/g, ' ') + '...';
    onConfirm(title, sanitization.sanitizedText, priority, stationId);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-conversion-title"
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-5 shadow-2xl space-y-4">
        {/* En-tête */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-amber-950/80 border border-amber-800 text-amber-300">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 id="modal-conversion-title" className="text-sm font-bold text-white">
                Passerelle Sécurisée : Conversion Message vers Incident ITSM
              </h3>
              <p className="text-xs text-slate-400">
                Application de la décontamination des données sensibles (Recommandation 29 GAFI)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-md"
            aria-label="Fermer la modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Rapport de Caviardage Automatique */}
        <div className="bg-emerald-950/40 border border-emerald-800/80 rounded-lg p-3 text-xs text-emerald-200">
          <div className="font-semibold text-emerald-300 flex items-center space-x-1.5 mb-1">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Filtre d'Anonymisation Anti-Porosité Validé</span>
          </div>
          <p className="text-[11px] text-emerald-200/90 leading-relaxed">
            {sanitization.itemsRedactedCount > 0 ? (
              <>
                <strong className="text-emerald-100">{sanitization.itemsRedactedCount} élément(s) sensible(s)</strong> ont été automatiquement neutralisés :{' '}
                {sanitization.detectedCategories.join(', ')}. L'équipe SSI ne recevra aucun identifiant bancaire ni montant d'enquête.
              </>
            ) : (
              'Aucune donnée financière ou bancaire sensible n\'a été détectée dans ce message.'
            )}
          </p>
        </div>

        {/* Comparaison Avant / Après */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">Texte Original (Canal Chiffré) :</label>
            <div className="bg-slate-950 border border-slate-800 rounded p-2.5 text-slate-300 text-[11px] h-28 overflow-y-auto leading-relaxed">
              {message.texteClair}
            </div>
          </div>

          <div>
            <label className="block text-[11px] text-amber-400 mb-1">Contenu Transmis au SSI (Caviardé) :</label>
            <div className="bg-slate-950 border border-amber-900/60 rounded p-2.5 text-amber-200 text-[11px] h-28 overflow-y-auto leading-relaxed">
              {sanitization.sanitizedText}
            </div>
          </div>
        </div>

        {/* Paramètres de l'incident */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div>
            <label htmlFor="modal-priority-select" className="block text-[11px] font-mono text-slate-400 mb-1">
              Niveau de Criticité Détecté :
            </label>
            <select
              id="modal-priority-select"
              value={priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-amber-400"
            >
              <option value="P1">P1 - Critique (SLA 2h / Contrainte Décret 48h)</option>
              <option value="P2">P2 - Majeure (SLA 4h / Dégradation Enquête)</option>
              <option value="P3">P3 - Normale (SLA 8h / Incident Bureautique)</option>
              <option value="P4">P4 - Demande d'assistance</option>
            </select>
          </div>

          <div>
            <label htmlFor="modal-station-input" className="block text-[11px] font-mono text-slate-400 mb-1">
              Terminal Émetteur :
            </label>
            <input
              id="modal-station-input"
              type="text"
              value={stationId}
              onChange={(e) => setStationId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-slate-200 font-mono focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {priority === 'P1' && (
          <div className="p-2 bg-red-950/60 border border-red-800 rounded text-[11px] text-red-200 flex items-center space-x-2 font-mono">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>Escalade automatique déclenchée vers le RSSI et le Directeur Général de l'ANIF sous 15 minutes.</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-white rounded"
          >
            Annuler
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-xs flex items-center space-x-1.5 transition-colors shadow-md"
          >
            <span>Transmettre au Support SSI</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
