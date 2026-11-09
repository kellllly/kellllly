import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid,
  Legend
} from 'recharts';
import {
  Flame,
  ShieldAlert,
  Zap,
  Lock,
  Clock,
  Filter,
  Info,
  Maximize2
} from 'lucide-react';
import { AuditEntry } from '../types';
import { computeSecurityHeatmapMetrics, HeatmapBucket, SecurityEventPoint } from '../utils/securityHeatmap';

interface SecurityHeatmapProps {
  auditLogs: AuditEntry[];
  activeAttacksBlocked?: number;
  onSimulateAttack?: () => void;
  onSimulateRateLimit?: () => void;
}

export const SecurityHeatmap: React.FC<SecurityHeatmapProps> = ({
  auditLogs,
  activeAttacksBlocked = 248,
  onSimulateAttack,
  onSimulateRateLimit
}) => {
  const [selectedBucket, setSelectedBucket] = useState<HeatmapBucket | null>(null);
  const [filterType, setFilterType] = useState<'ALL' | 'RATE_LIMIT' | 'UNAUTHORIZED'>('ALL');

  const metrics = computeSecurityHeatmapMetrics(auditLogs, activeAttacksBlocked);

  // Formattage des données pour Recharts BarChart empilé
  const chartData = metrics.buckets.map((b) => ({
    timeSlot: b.timeSlot,
    'Rate Limit Bloqué': b.rateLimitCount,
    'Accès Non Autorisé': b.unauthorizedCount,
    total: b.totalBlocked,
    intensity: b.intensity,
    dominant: b.dominantType,
    bucketRef: b
  }));

  // Couleur dynamique de la cellule selon le type dominant et l'intensité
  const getCellColor = (bucket: HeatmapBucket) => {
    if (bucket.totalBlocked === 0) return '#1e293b'; // slate-800
    if (bucket.dominantType === 'UNAUTHORIZED_ACCESS') {
      if (bucket.intensity > 70) return '#ef4444'; // red-500
      if (bucket.intensity > 35) return '#f87171'; // red-400
      return '#b91c1c'; // red-700
    }
    if (bucket.dominantType === 'RATE_LIMIT') {
      if (bucket.intensity > 70) return '#f59e0b'; // amber-500
      if (bucket.intensity > 35) return '#fbbf24'; // amber-400
      return '#d97706'; // amber-600
    }
    // Équilibré / mixte
    return '#8b5cf6'; // purple-500
  };

  return (
    <div
      data-testid="security-heatmap-container"
      className="col-span-12 backdrop-blur-2xl bg-slate-900/50 border border-slate-700/60 hover:border-amber-500/50 p-4 sm:p-5 rounded-2xl shadow-2xl space-y-4 relative overflow-hidden transition-all group"
    >
      {/* Halo de fond thématique */}
      <div className="absolute -top-16 -right-16 w-48 h-48 bg-gradient-to-br from-amber-500/10 via-red-500/10 to-transparent rounded-full blur-3xl pointer-events-none group-hover:from-amber-500/20 group-hover:via-red-500/20 transition-all duration-700" />

      {/* 1. En-tête Heatmap */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-950 to-red-950 border border-amber-600/80 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.25)]">
            <Flame className="w-5 h-5 animate-pulse text-amber-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="font-bold text-sm text-white uppercase tracking-wider flex items-center gap-1.5">
                <span>Security Heatmap — Fréquence des Bloquages Temps Réel</span>
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-800 font-bold">
                RECHARTS v2
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Distribution temporelle des attaques Rate-Limit (Token Bucket WAF) et violations d'accès (FIDO2 / RBAC / SQLi / XSS)
            </p>
          </div>
        </div>

        {/* Badges d'état & niveau de menace */}
        <div className="flex items-center gap-2">
          <div className="flex items-center space-x-1.5 bg-slate-950/80 px-2.5 py-1 rounded-xl border border-slate-800 text-[11px] font-mono">
            <span className="text-slate-400">Niveau de Menace :</span>
            <span
              className={`font-bold px-1.5 py-0.2 rounded text-[10px] ${
                metrics.threatLevel === 'CRITIQUE'
                  ? 'bg-red-950 text-red-300 border border-red-800'
                  : metrics.threatLevel === 'ELEVÉ'
                  ? 'bg-amber-950 text-amber-300 border border-amber-800'
                  : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
              }`}
            >
              {metrics.threatLevel}
            </span>
          </div>

          {onSimulateAttack && (
            <button
              onClick={onSimulateAttack}
              className="px-2.5 py-1 bg-red-950/70 hover:bg-red-900/80 text-red-300 border border-red-700/80 rounded-xl text-xs font-mono font-bold flex items-center space-x-1 transition-all cursor-pointer shadow-[0_0_10px_rgba(239,68,68,0.2)]"
              title="Injecter une tentative d'intrusion non autorisée"
            >
              <ShieldAlert className="w-3 h-3 text-red-400" />
              <span>+ Intrusions</span>
            </button>
          )}

          {onSimulateRateLimit && (
            <button
              onClick={onSimulateRateLimit}
              className="px-2.5 py-1 bg-amber-950/70 hover:bg-amber-900/80 text-amber-300 border border-amber-700/80 rounded-xl text-xs font-mono font-bold flex items-center space-x-1 transition-all cursor-pointer shadow-[0_0_10px_rgba(245,158,11,0.2)]"
              title="Injecter une rafale de requêtes bloquées"
            >
              <Zap className="w-3 h-3 text-amber-400" />
              <span>+ Dépassements</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Cartes Synthétiques KPI de Menace */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono text-xs">
        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1">
          <div className="text-[10px] text-slate-500 uppercase flex items-center justify-between">
            <span>Total Bloqué (24h)</span>
            <Flame className="w-3 h-3 text-amber-500" />
          </div>
          <div className="text-xl font-bold text-white tabular-nums">{metrics.totalEvents}</div>
          <div className="text-[10px] text-slate-400">Rejeté par WAF / Enclave</div>
        </div>

        <div className="bg-slate-950/80 p-3 rounded-xl border border-amber-900/40 space-y-1">
          <div className="text-[10px] text-amber-400 uppercase flex items-center justify-between">
            <span>Rate-Limit (DDoS)</span>
            <Zap className="w-3 h-3 text-amber-400" />
          </div>
          <div className="text-xl font-bold text-amber-400 tabular-nums">{metrics.rateLimitTotal}</div>
          <div className="text-[10px] text-slate-400">Token Bucket (HTTP 429)</div>
        </div>

        <div className="bg-slate-950/80 p-3 rounded-xl border border-red-900/40 space-y-1">
          <div className="text-[10px] text-red-400 uppercase flex items-center justify-between">
            <span>Accès Non Autorisés</span>
            <Lock className="w-3 h-3 text-red-400" />
          </div>
          <div className="text-xl font-bold text-red-400 tabular-nums">{metrics.unauthorizedTotal}</div>
          <div className="text-[10px] text-slate-400">FIDO2 / RBAC / SQLi / XSS</div>
        </div>

        <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 space-y-1">
          <div className="text-[10px] text-slate-500 uppercase flex items-center justify-between">
            <span>Créneau le Plus Actif</span>
            <Clock className="w-3 h-3 text-cyan-400" />
          </div>
          <div className="text-base font-bold text-cyan-400 truncate">{metrics.peakSlot}</div>
          <div className="text-[10px] text-slate-400">{metrics.peakCount} attaques bloquées</div>
        </div>
      </div>

      {/* 3. Graphique Recharts & Visual Heatmap Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* Graphique à barres empilées Recharts (col 7) */}
        <div className="lg:col-span-7 bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400 mb-2">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>Volume des Événements Bloqués par Fenêtre Horaires</span>
            </span>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="flex items-center gap-1 text-amber-300">
                <span className="w-2 h-2 bg-amber-500 rounded-sm" /> Rate-Limit
              </span>
              <span className="flex items-center gap-1 text-red-300">
                <span className="w-2 h-2 bg-red-500 rounded-sm" /> Accès Non Autorisé
              </span>
            </div>
          </div>

          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                onClick={(data: any) => {
                  if (data && data.activePayload && data.activePayload.length > 0) {
                    const bucket = data.activePayload[0].payload.bucketRef as HeatmapBucket;
                    setSelectedBucket(bucket);
                  }
                }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="timeSlot" stroke="#64748b" fontSize={10} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={10} tickLine={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 border border-slate-700 p-2.5 rounded-lg shadow-xl text-xs font-mono">
                          <div className="font-bold text-white mb-1">Fenêtre : {label}</div>
                          <div className="text-amber-400">
                            Rate Limit bloqué : {data['Rate Limit Bloqué']}
                          </div>
                          <div className="text-red-400">
                            Accès non autorisé : {data['Accès Non Autorisé']}
                          </div>
                          <div className="text-slate-300 border-t border-slate-800 pt-1 mt-1 font-bold">
                            Total : {data.total} bloquages (Intensité {data.intensity}%)
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="Rate Limit Bloqué" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Accès Non Autorisé" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Matrice Grille Heatmap Temporelle (col 5) */}
        <div className="lg:col-span-5 bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-col justify-between space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Matrice d'Intensité Thermique (d3/Grid)</span>
            <span className="text-[10px] text-slate-500">Cliquer pour zoom</span>
          </div>

          {/* Grille 6 cases thermiques colorées proportionnellement */}
          <div className="grid grid-cols-3 gap-2">
            {metrics.buckets.map((bucket) => {
              const isSelected = selectedBucket?.timeSlot === bucket.timeSlot;
              const cellColor = getCellColor(bucket);

              return (
                <button
                  key={bucket.timeSlot}
                  onClick={() => setSelectedBucket(isSelected ? null : bucket)}
                  className={`p-2.5 rounded-xl border text-left transition-all relative overflow-hidden flex flex-col justify-between h-20 ${
                    isSelected
                      ? 'border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.4)] scale-102 bg-slate-900'
                      : 'border-slate-800 hover:border-slate-700 bg-slate-950/90'
                  }`}
                  style={{
                    boxShadow: bucket.totalBlocked > 0 ? `inset 0 0 20px ${cellColor}22` : undefined
                  }}
                >
                  {/* Indicateur de jauge en arrière plan */}
                  <div
                    className="absolute bottom-0 left-0 right-0 opacity-20 pointer-events-none transition-all duration-500"
                    style={{
                      height: `${Math.max(10, bucket.intensity)}%`,
                      backgroundColor: cellColor
                    }}
                  />

                  <div className="flex items-center justify-between z-10">
                    <span className="text-[11px] font-mono font-bold text-slate-300">{bucket.timeSlot}</span>
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: cellColor }}
                      title={`Type dominant: ${bucket.dominantType}`}
                    />
                  </div>

                  <div className="z-10 font-mono">
                    <div className="text-base font-bold text-white tabular-nums">{bucket.totalBlocked}</div>
                    <div className="text-[9px] text-slate-400 flex items-center justify-between">
                      <span className="text-amber-400">{bucket.rateLimitCount} RL</span>
                      <span className="text-red-400">{bucket.unauthorizedCount} NA</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Légende de gradient thermique */}
          <div className="pt-2 border-t border-slate-900 flex items-center justify-between text-[10px] font-mono text-slate-500">
            <span>Faible Menace</span>
            <div className="flex items-center gap-1">
              <span className="w-3 h-2 rounded-xs bg-slate-800" />
              <span className="w-3 h-2 rounded-xs bg-amber-600" />
              <span className="w-3 h-2 rounded-xs bg-amber-500" />
              <span className="w-3 h-2 rounded-xs bg-red-500" />
              <span className="w-3 h-2 rounded-xs bg-red-700" />
            </div>
            <span>Menace Critique</span>
          </div>
        </div>
      </div>

      {/* 4. Tiroir Déroulant de Détails si un créneau ou événement est inspecté */}
      {selectedBucket && (
        <div className="p-3 bg-slate-950/95 rounded-xl border border-cyan-800/80 animate-in fade-in duration-200 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center space-x-2">
              <span className="font-bold text-cyan-300">Fenêtre sélectionnée : {selectedBucket.timeSlot}</span>
              <span className="text-slate-400">•</span>
              <span className="text-white">{selectedBucket.totalBlocked} bloquages enregistrés</span>
              <span className="text-slate-500">({selectedBucket.rateLimitCount} Rate-Limit, {selectedBucket.unauthorizedCount} Non-Autorisés)</span>
            </div>
            <button
              onClick={() => setSelectedBucket(null)}
              className="text-[10px] text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700"
            >
              Fermer l'inspection
            </button>
          </div>

          {selectedBucket.events.length > 0 ? (
            <div className="space-y-1.5 max-h-36 overflow-y-auto font-mono text-[11px]">
              {selectedBucket.events.map((ev) => (
                <div
                  key={ev.id}
                  className="p-2 bg-slate-900/90 rounded-lg border border-slate-800 flex items-center justify-between gap-2"
                >
                  <div className="flex items-center space-x-2 truncate">
                    <span
                      className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                        ev.type === 'RATE_LIMIT'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-red-950 text-red-300 border border-red-800'
                      }`}
                    >
                      {ev.type}
                    </span>
                    <span className="text-slate-300 font-bold">{ev.action}</span>
                    <span className="text-slate-500 text-[10px]">{ev.details}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 shrink-0 font-mono">
                    {ev.timeLabel} UTC
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-slate-500 font-mono italic">
              Blocs synthétiques simulés sur ce créneau horaire lors des contrôles périodiques du WAF Nkok.
            </div>
          )}
        </div>
      )}
    </div>
  );
};
