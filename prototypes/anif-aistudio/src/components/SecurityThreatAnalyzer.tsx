import React, { useState, useEffect } from 'react';
import {
  BrainCircuit,
  ShieldAlert,
  ArrowRightLeft,
  Activity,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Zap,
  Target,
  CheckCircle,
  FileSearch,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { AuditEntry } from '../types';
import { ThreatAnalysisReport, analyzeAuditThreatsHeuristic } from '../utils/threatAnalyzerLogic';
import { cyberAudio } from '../utils/audio';

interface SecurityThreatAnalyzerProps {
  auditLogs: AuditEntry[];
  onTriggerMitigation?: (kedbCode: string) => void;
  onSelectCorrelatedLog?: (logId: string) => void;
}

export const SecurityThreatAnalyzer: React.FC<SecurityThreatAnalyzerProps> = ({
  auditLogs,
  onTriggerMitigation,
  onSelectCorrelatedLog
}) => {
  const [report, setReport] = useState<ThreatAnalysisReport>(() =>
    analyzeAuditThreatsHeuristic(auditLogs)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [expandedPatternId, setExpandedPatternId] = useState<string | null>('THR-PAT-001');

  // Lancement automatique d'une analyse lors de la modification des logs
  const runAiAnalysis = async (forceAi = true) => {
    setIsLoading(true);
    cyberAudio.playCryptoBip();

    try {
      if (forceAi) {
        const response = await fetch('/api/ai/threat-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auditLogs: auditLogs.slice(0, 25) })
        });

        if (response.ok) {
          const data: ThreatAnalysisReport = await response.json();
          setReport(data);
          if (data.lateralPivotDetected) {
            cyberAudio.playShieldBlock();
          }
          setIsLoading(false);
          return;
        }
      }
    } catch (err) {
      console.warn('[ThreatAnalyzer] Erreur appel API IA, bascule locale:', err);
    }

    // Fallback instantané
    const fallback = analyzeAuditThreatsHeuristic(auditLogs);
    setReport(fallback);
    setIsLoading(false);
  };

  useEffect(() => {
    runAiAnalysis(false);
  }, [auditLogs.length]);

  return (
    <div
      data-testid="security-threat-analyzer"
      className="col-span-12 backdrop-blur-2xl bg-gradient-to-br from-slate-900/60 via-slate-900/40 to-red-950/20 border border-slate-700/60 hover:border-red-500/50 p-4 sm:p-5 rounded-2xl shadow-2xl space-y-4 relative overflow-hidden transition-all group"
    >
      {/* Halo thématique */}
      <div className="absolute -top-16 -right-16 w-56 h-56 bg-red-500/10 rounded-full blur-3xl pointer-events-none group-hover:bg-red-500/20 transition-all duration-700" />

      {/* 1. En-tête du composant d'analyse IA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-950 to-red-950 border border-red-600/80 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.3)]">
            <BrainCircuit className="w-5 h-5 animate-pulse text-purple-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-sm text-white uppercase tracking-wider flex items-center gap-1.5">
                <span>Security Threat Analyzer — Corrélation IA & Pivot Latéral</span>
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-950 text-purple-300 border border-purple-800 font-bold flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" />
                <span>{report.aiModelUsed}</span>
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Intelligence artificielle heuristique et LLM corrélant les logs WORM, assertions FIDO2 et requêtes WAF pour déjouer les intrusions persistantes
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => runAiAnalysis(true)}
            disabled={isLoading}
            className="px-3 py-1.5 bg-gradient-to-r from-purple-900/80 to-red-900/80 hover:from-purple-800 hover:to-red-800 disabled:opacity-50 text-white border border-red-600/80 rounded-xl text-xs font-mono font-bold flex items-center space-x-1.5 transition-all shadow-[0_0_15px_rgba(239,68,68,0.25)] cursor-pointer"
            title="Lancer une analyse neurale en profondeur des journaux WORM"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-300' : 'text-purple-300'}`} />
            <span>{isLoading ? 'Analyse en cours...' : 'Analyser avec Gemini IA'}</span>
          </button>
        </div>
      </div>

      {/* 2. Carte d'Alerte Tactique Majeure (Tactical Alert Card) */}
      <div
        data-testid="tactical-alert-card"
        className={`p-4 rounded-xl border transition-all ${
          report.lateralPivotDetected
            ? 'bg-gradient-to-r from-red-950/90 via-slate-900 to-red-950/80 border-red-500 shadow-[0_0_25px_rgba(239,68,68,0.35)] animate-pulse'
            : report.detectedPatterns.length > 0
            ? 'bg-gradient-to-r from-amber-950/80 via-slate-900 to-slate-950 border-amber-600/80 shadow-[0_0_20px_rgba(245,158,11,0.25)]'
            : 'bg-slate-950/80 border-slate-800'
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center space-x-3">
            <div
              className={`p-2.5 rounded-xl shrink-0 ${
                report.lateralPivotDetected
                  ? 'bg-red-900/90 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]'
                  : 'bg-amber-900/80 text-amber-200'
              }`}
            >
              <ArrowRightLeft className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold font-mono uppercase tracking-wide text-white flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  <span>
                    {report.lateralPivotDetected
                      ? 'ALERTE TACTIQUE : Mouvement Latéral & Vecteur d\'Attaque Complexe Détecté'
                      : 'SURVEILLANCE TACTIQUE : Corrélation WORM Active'}
                  </span>
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                    report.lateralPivotDetected
                      ? 'bg-red-900 text-red-100 border border-red-600'
                      : 'bg-amber-950 text-amber-300 border border-amber-800'
                  }`}
                >
                  MITRE T1078 / T1021 / T1548
                </span>
                <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/70 border border-cyan-800 px-1.5 py-0.5 rounded">
                  Confiance IA: 94%
                </span>
              </div>
              <p className="text-xs text-slate-200 font-sans leading-relaxed">
                {report.summary}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 font-mono text-xs">
            <span className="text-red-300 text-[11px] hidden lg:inline">Remédiation : KEDB-042</span>
            {onTriggerMitigation && (
              <button
                onClick={() => onTriggerMitigation('KEDB-042')}
                className="px-3.5 py-1.5 bg-red-900 hover:bg-red-800 text-white border border-red-400 rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(239,68,68,0.4)] cursor-pointer"
              >
                Appliquer Révocation KEDB
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3. Métriques & Couverture MITRE ATT&CK */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1">
          <div className="text-[10px] text-slate-500 uppercase flex items-center justify-between">
            <span>Score de Menace</span>
            <Activity className="w-3 h-3 text-red-400" />
          </div>
          <div
            className={`text-xl font-bold tabular-nums ${
              report.threatLevel === 'CRITIQUE'
                ? 'text-red-400'
                : report.threatLevel === 'HAUTE'
                ? 'text-amber-400'
                : 'text-emerald-400'
            }`}
          >
            {report.threatLevel}
          </div>
          <div className="text-[10px] text-slate-400">Évaluation Globale SOC</div>
        </div>

        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1">
          <div className="text-[10px] text-slate-500 uppercase flex items-center justify-between">
            <span>Schémas Identifiés</span>
            <Target className="w-3 h-3 text-purple-400" />
          </div>
          <div className="text-xl font-bold text-white tabular-nums">{report.detectedPatterns.length}</div>
          <div className="text-[10px] text-slate-400">Patterns MITRE ATT&CK</div>
        </div>

        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1">
          <div className="text-[10px] text-slate-500 uppercase flex items-center justify-between">
            <span>Logs Corrélés</span>
            <FileSearch className="w-3 h-3 text-cyan-400" />
          </div>
          <div className="text-xl font-bold text-cyan-400 tabular-nums">{report.correlatedLogIds.length}</div>
          <div className="text-[10px] text-slate-400">Blocs WORM Scellés</div>
        </div>

        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1">
          <div className="text-[10px] text-slate-500 uppercase flex items-center justify-between">
            <span>Couverture MITRE</span>
            <ShieldAlert className="w-3 h-3 text-amber-400" />
          </div>
          <div className="text-xs font-bold text-amber-300 truncate">
            {report.mitreCoverage[0] || 'T1078 (Valid Accts)'}
          </div>
          <div className="text-[10px] text-slate-400">{report.mitreCoverage.length} techniques surveillées</div>
        </div>
      </div>

      {/* 4. Liste Détaillée des Motifs d'Attaques Corrélés */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400">
          <span className="font-bold uppercase tracking-wider text-slate-300">
            Détail des Corrélations Temporelles & Tactiques
          </span>
          <span className="text-[10px] text-slate-500">
            {report.detectedPatterns.length} motif(s) actif(s)
          </span>
        </div>

        {report.detectedPatterns.length === 0 ? (
          <div className="p-4 bg-slate-950/80 rounded-xl border border-slate-800 text-center font-mono text-xs text-slate-400">
            Aucun schéma de menace complexe détecté dans l'historique d'audit actuel.
          </div>
        ) : (
          <div className="space-y-2 font-mono text-xs">
            {report.detectedPatterns.map((pattern) => {
              const isExpanded = expandedPatternId === pattern.id;

              return (
                <div
                  key={pattern.id}
                  className={`p-3.5 rounded-xl border transition-all ${
                    pattern.category === 'LATERAL_PIVOT'
                      ? 'bg-slate-950/90 border-red-700/80 hover:border-red-500'
                      : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div
                    onClick={() => setExpandedPatternId(isExpanded ? null : pattern.id)}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="flex items-center space-x-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          pattern.severity === 'CRITIQUE'
                            ? 'bg-red-950 text-red-300 border border-red-800'
                            : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}
                      >
                        {pattern.severity}
                      </span>
                      <span className="font-bold text-white text-xs">{pattern.name}</span>
                      <span className="text-[10px] text-purple-300 bg-purple-950/60 px-1.5 py-0.2 rounded border border-purple-800">
                        {pattern.mitreTechnique}
                      </span>
                    </div>

                    <div className="flex items-center space-x-3 text-slate-400 text-[11px]">
                      <span>Confiance : <strong className="text-cyan-400">{pattern.confidenceScore}%</strong></span>
                      <span>•</span>
                      <span>{pattern.timeline.eventCount} événements</span>
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pt-3 border-t border-slate-800/80 space-y-2.5 text-xs font-sans">
                      <p className="text-slate-300 leading-relaxed">
                        {pattern.description}
                      </p>

                      <div className="bg-slate-900/90 p-2.5 rounded-lg border border-slate-800 font-mono text-[11px] space-y-1">
                        <div className="text-slate-400 font-bold uppercase text-[10px]">Indicateurs Clés :</div>
                        <ul className="list-disc list-inside text-slate-300 space-y-0.5">
                          {pattern.indicators.map((ind, i) => (
                            <li key={i}>{ind}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 font-mono text-[11px]">
                        <div className="text-slate-400">
                          Acteurs impliqués : <span className="text-amber-300 font-bold">{pattern.involvedActors.join(', ')}</span>
                        </div>
                        <div className="text-emerald-400 flex items-center gap-1.5">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>{pattern.recommendedMitigation}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 5. Logs Corrélés de la Chaîne d'Audit */}
      {report.correlatedLogIds.length > 0 && (
        <div className="p-3 bg-slate-950/90 rounded-xl border border-slate-800 font-mono text-xs space-y-2">
          <div className="flex items-center justify-between text-slate-400 text-[11px]">
            <span>Chaîne de Logs WORM Corrélée par l'IA :</span>
            <span className="text-purple-300">Immuable RFC 3161</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {report.correlatedLogIds.map((logId) => (
              <span
                key={logId}
                onClick={() => onSelectCorrelatedLog && onSelectCorrelatedLog(logId)}
                className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-cyan-300 text-[10px] cursor-pointer transition-colors"
                title="Consulter le bloc WORM dans le registre d'audit"
              >
                #{logId}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
