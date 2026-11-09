import React, { useState } from 'react';
import { X, CheckCircle, BookOpen, Clock, AlertOctagon, User } from 'lucide-react';
import { ItsmTicket, TicketStatus } from '../types';
import { KEDB_ARTICLES } from '../data/initialData';
import { formatSecondsToSla } from '../utils/sanitizer';

interface TicketDetailModalProps {
  ticket: ItsmTicket | null;
  onClose: () => void;
  onUpdateStatus: (ticketId: string, newStatus: TicketStatus, solution?: string) => void;
}

export const TicketDetailModal: React.FC<TicketDetailModalProps> = ({
  ticket,
  onClose,
  onUpdateStatus
}) => {
  const [solutionInput, setSolutionInput] = useState('');

  if (!ticket) return null;

  const sla = formatSecondsToSla(ticket.slaSecondesRestantes);
  // Match potential KEDB article
  const matchedKedb = KEDB_ARTICLES.find(
    (k) =>
      ticket.titre.toLowerCase().includes('nkok') ||
      ticket.titre.toLowerCase().includes('fido2') ||
      ticket.titre.toLowerCase().includes('minio')
  );

  const handleApplyResolution = () => {
    const sol = solutionInput.trim() || matchedKedb?.resolutionDefinitive || 'Incident résolu conformément aux procédures SSI';
    onUpdateStatus(ticket.id, 'RESOLU', sol);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-ticket-detail-title"
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <span className="font-mono font-bold text-amber-400 text-sm">{ticket.id}</span>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                ticket.priorite === 'P1'
                  ? 'bg-red-900 text-red-100'
                  : ticket.priorite === 'P2'
                  ? 'bg-amber-900 text-amber-200'
                  : 'bg-blue-900 text-blue-200'
              }`}
            >
              {ticket.priorite}
            </span>
            <h3 id="modal-ticket-detail-title" className="text-sm font-bold text-white">
              {ticket.titre}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Détails du ticket */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-slate-950 p-3 rounded-lg border border-slate-800">
          <div>
            <div className="text-[10px] text-slate-500">Demandeur</div>
            <div className="text-slate-200 font-bold">{ticket.demandeurNom}</div>
            <div className="text-[10px] text-slate-400">{ticket.demandeurMatricule}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">Technicien Assigné</div>
            <div className="text-slate-200">{ticket.technicienAssigne || 'Non assigné'}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">Statut ITIL</div>
            <div className="text-emerald-400 font-bold">{ticket.statut}</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500">SLA Restant</div>
            <div className={`font-bold ${sla.isUrgent ? 'text-red-400' : 'text-slate-200'}`}>
              {sla.formatted}
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-mono text-slate-400 mb-1">
            Description Anonymisée (Passerelle Zero-Knowledge) :
          </label>
          <div className="bg-slate-950 border border-slate-800 rounded p-3 text-xs text-slate-200 font-mono leading-relaxed">
            {ticket.descriptionAnonymisee}
          </div>
        </div>

        {/* Article KEDB recommandé */}
        {matchedKedb && (
          <div className="bg-blue-950/30 border border-blue-800/80 rounded-lg p-3 space-y-1.5 text-xs">
            <div className="flex items-center space-x-1.5 font-bold text-blue-300">
              <BookOpen className="w-4 h-4 text-blue-400" />
              <span>Article KEDB Correspondant : {matchedKedb.codeErreur} ({matchedKedb.titre})</span>
            </div>
            <div className="text-slate-300 text-[11px]">
              <span className="font-semibold text-slate-200">Solution Recommandée :</span> {matchedKedb.resolutionDefinitive}
            </div>
          </div>
        )}

        {/* Champ de clôture */}
        {ticket.statut !== 'RESOLU' && (
          <div>
            <label htmlFor="solution-input" className="block text-xs font-mono text-slate-400 mb-1">
              Procédure de Résolution & Injection KEDB :
            </label>
            <input
              id="solution-input"
              type="text"
              value={solutionInput}
              onChange={(e) => setSolutionInput(e.target.value)}
              placeholder={matchedKedb ? matchedKedb.resolutionDefinitive : "Détailler la solution technique appliquée..."}
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
            />
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
          <div className="space-x-1 font-mono">
            <button
              onClick={() => onUpdateStatus(ticket.id, 'ASSIGNE_L1')}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px]"
            >
              Assigner L1
            </button>
            <button
              onClick={() => onUpdateStatus(ticket.id, 'ESCALADE_L2')}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px]"
            >
              Escalade L2
            </button>
            <button
              onClick={() => onUpdateStatus(ticket.id, 'EXPERTISE_L3')}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px]"
            >
              Expertise L3 (Crise)
            </button>
          </div>

          <div className="flex space-x-2">
            <button onClick={onClose} className="px-3 py-1.5 text-slate-400 hover:text-white">
              Fermer
            </button>
            {ticket.statut !== 'RESOLU' && (
              <button
                onClick={handleApplyResolution}
                className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white font-bold rounded flex items-center space-x-1"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Clôturer & Enregistrer KEDB</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
