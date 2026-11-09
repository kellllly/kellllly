import React, { useState } from 'react';
import { X, Check, Terminal, FileCode, Shield, Download } from 'lucide-react';
import { SOVEREIGN_SPECS } from '../data/sovereignSpecs';

interface ArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ArchitectureModal: React.FC<ArchitectureModalProps> = ({ isOpen, onClose }) => {
  const [selectedFile, setSelectedFile] = useState<'golang' | 'postgres' | 'kubernetes'>('golang');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(SOVEREIGN_SPECS[selectedFile]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const filenames = {
      golang: 'main.go',
      postgres: 'init_anif_sovereign_db.sql',
      kubernetes: 'anif-sovereignty-deploy.yaml'
    };
    const blob = new Blob([SOVEREIGN_SPECS[selectedFile]], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filenames[selectedFile];
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-arch-title"
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-3 sm:p-6 backdrop-blur-xs animate-fadeIn"
    >
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-5xl h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* En-tête */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-950/60">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-blue-950/80 border border-blue-800 text-blue-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h2 id="modal-arch-title" className="text-sm font-bold text-white flex items-center space-x-2">
                <span>Architecture Souveraine Déployée - Data Center de Nkok Tier III</span>
                <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded font-mono">
                  ZES NKOK // RECO 29 GAFI
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Code source complet du relais Zero-Knowledge, schéma relationnel durci RLS et manifestes de déploiement Kubernetes.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Fermer">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Sélecteur de fichiers */}
        <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex space-x-2">
            <button
              onClick={() => setSelectedFile('golang')}
              className={`px-3 py-1.5 rounded text-xs font-mono transition-colors flex items-center space-x-1.5 ${
                selectedFile === 'golang'
                  ? 'bg-blue-900/70 text-blue-200 border border-blue-600 font-bold'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>1. Relais Backend Go (main.go)</span>
            </button>

            <button
              onClick={() => setSelectedFile('postgres')}
              className={`px-3 py-1.5 rounded text-xs font-mono transition-colors flex items-center space-x-1.5 ${
                selectedFile === 'postgres'
                  ? 'bg-blue-900/70 text-blue-200 border border-blue-600 font-bold'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>2. Schéma PostgreSQL 16+ RLS (init.sql)</span>
            </button>

            <button
              onClick={() => setSelectedFile('kubernetes')}
              className={`px-3 py-1.5 rounded text-xs font-mono transition-colors flex items-center space-x-1.5 ${
                selectedFile === 'kubernetes'
                  ? 'bg-blue-900/70 text-blue-200 border border-blue-600 font-bold'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>3. Kubernetes Nkok (deploy.yaml)</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleDownload}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs font-mono flex items-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Télécharger</span>
            </button>
            <button
              onClick={handleCopy}
              className="px-3 py-1.5 bg-emerald-900/80 hover:bg-emerald-800 text-emerald-100 border border-emerald-700 rounded text-xs font-mono font-semibold flex items-center space-x-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Terminal className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copié !' : 'Copier'}</span>
            </button>
          </div>
        </div>

        {/* Zone de code */}
        <div className="flex-1 overflow-auto bg-black p-4 font-mono text-xs text-slate-200">
          <pre className="whitespace-pre leading-relaxed select-text">
            {SOVEREIGN_SPECS[selectedFile]}
          </pre>
        </div>
      </div>
    </div>
  );
};
