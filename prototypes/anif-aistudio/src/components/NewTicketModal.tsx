import React, { useState } from 'react';
import { PlusCircle, X, ShieldAlert } from 'lucide-react';
import { TicketPriority, UserProfile } from '../types';

interface NewTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile;
  onCreate: (
    title: string,
    description: string,
    priority: TicketPriority,
    isLegalConstraint: boolean
  ) => void;
}

export const NewTicketModal: React.FC<NewTicketModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onCreate
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TicketPriority>('P2');
  const [isLegalConstraint, setIsLegalConstraint] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    onCreate(title.trim(), description.trim(), priority, isLegalConstraint);
    setTitle('');
    setDescription('');
    setPriority('P2');
    setIsLegalConstraint(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-new-ticket-title"
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs animate-fadeIn"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <PlusCircle className="w-5 h-5 text-amber-400" />
            <h3 id="modal-new-ticket-title" className="text-sm font-bold text-white">
              Déclarer un Nouvel Incident SI (ITIL v4)
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
          <div>
            <label htmlFor="ticket-title-input" className="block text-slate-300 font-mono mb-1">
              Intitulé Synthétique :
            </label>
            <input
              id="ticket-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Ralentissement liaison gRPC Nkok ou anomalie SSO"
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label htmlFor="ticket-desc-input" className="block text-slate-300 font-mono mb-1">
              Description Technique (Données Métier Strictement Anonymisées) :
            </label>
            <textarea
              id="ticket-desc-input"
              rows={3}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Préciser les messages d'erreur, les codes d'anomalie réseau ou les postes concernés..."
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white focus:outline-none focus:border-amber-400 font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ticket-priority-select" className="block text-slate-300 font-mono mb-1">
                Criticité & SLA :
              </label>
              <select
                id="ticket-priority-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-amber-400"
              >
                <option value="P1">P1 - Critique (MTTR &lt; 2h)</option>
                <option value="P2">P2 - Majeure (MTTR &lt; 4h)</option>
                <option value="P3">P3 - Normale (MTTR &lt; 8h)</option>
                <option value="P4">P4 - Demande (Délai 48h)</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-300 font-mono mb-1">Demandeur :</label>
              <input
                type="text"
                disabled
                value={`${currentUser.matricule} (${currentUser.nom})`}
                className="w-full bg-slate-950/70 border border-slate-800 rounded px-2.5 py-1.5 text-slate-400 font-mono"
              />
            </div>
          </div>

          <div className="p-2.5 bg-slate-950 border border-slate-800 rounded flex items-center space-x-2">
            <input
              type="checkbox"
              id="legal-48h"
              checked={isLegalConstraint}
              onChange={(e) => setIsLegalConstraint(e.target.checked)}
              className="rounded border-slate-700 text-amber-500 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="legal-48h" className="text-[11px] text-slate-300 cursor-pointer">
              Incident lié à une astreinte légale d'opposition de 48h (Priorité maximale)
            </label>
          </div>

          <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs text-slate-400 hover:text-white"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-xs transition-colors"
            >
              Créer le Ticket
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
