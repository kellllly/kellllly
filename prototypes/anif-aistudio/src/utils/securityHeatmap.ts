/**
 * ANIF Gabon - Extraction & Agrégation de Télémétrie pour la Heatmap de Sécurité
 * Visualisation temps réel des événements de limitation de débit (Rate Limit) et accès non autorisés (Unauthorized Access)
 */

import { AuditEntry } from '../types';
import { categorizeAuditSecurityAction } from './securityMonitor';

export interface SecurityEventPoint {
  id: string;
  timestamp: string; // HH:mm ou ISO
  timeLabel: string; // Libellé pour l'axe temporel (ex: 14h, 15h ou 10:30)
  hourSlot: string; // Ex: '08:00', '10:00'
  type: 'RATE_LIMIT' | 'UNAUTHORIZED_ACCESS';
  action: string;
  acteur: string;
  details: string;
  severity: 'CRITIQUE' | 'HAUTE' | 'MOYENNE';
}

export interface HeatmapBucket {
  timeSlot: string; // Ex: "10:00 - 12:00" ou "08h", "10h", etc.
  rateLimitCount: number;
  unauthorizedCount: number;
  totalBlocked: number;
  intensity: number; // 0 à 100
  dominantType: 'RATE_LIMIT' | 'UNAUTHORIZED_ACCESS' | 'BALANCED' | 'NONE';
  events: SecurityEventPoint[];
}

export interface SecurityHeatmapMetrics {
  totalEvents: number;
  rateLimitTotal: number;
  unauthorizedTotal: number;
  peakSlot: string;
  peakCount: number;
  averagePerSlot: number;
  threatLevel: 'NOMINAL' | 'ELEVÉ' | 'CRITIQUE';
  buckets: HeatmapBucket[];
  recentEvents: SecurityEventPoint[];
}

// 6 Tranches horaires régulières pour la heatmap temporelle
export const DEFAULT_HEATMAP_SLOTS = [
  '00h-04h',
  '04h-08h',
  '08h-12h',
  '12h-16h',
  '16h-20h',
  '20h-24h'
] as const;

/**
 * Détermine le slot horaire d'une date
 */
export function getHourSlotFromDate(date: Date): string {
  const h = date.getUTCHours();
  if (h < 4) return '00h-04h';
  if (h < 8) return '04h-08h';
  if (h < 12) return '08h-12h';
  if (h < 16) return '12h-16h';
  if (h < 20) return '16h-20h';
  return '20h-24h';
}

/**
 * Extrait et qualifie tous les événements de sécurité bloqués à partir des logs d'audit
 */
export function extractSecurityEvents(auditLogs: AuditEntry[]): SecurityEventPoint[] {
  if (!auditLogs || auditLogs.length === 0) return [];

  const events: SecurityEventPoint[] = [];

  for (const log of auditLogs) {
    const category = categorizeAuditSecurityAction(log.action);
    if (!category) continue;

    // Détermination de l'horodatage
    let timeLabel = '12:00';
    let hourSlot = '12h-16h';

    // Essai de parsing RFC 3161 ou ISO
    if (log.timestampRFC3161) {
      const matchTime = log.timestampRFC3161.match(/(\d{2}):(\d{2})/);
      if (matchTime) {
        timeLabel = `${matchTime[1]}:${matchTime[2]}`;
        const hour = parseInt(matchTime[1], 10);
        if (hour < 4) hourSlot = '00h-04h';
        else if (hour < 8) hourSlot = '04h-08h';
        else if (hour < 12) hourSlot = '08h-12h';
        else if (hour < 16) hourSlot = '12h-16h';
        else if (hour < 20) hourSlot = '16h-20h';
        else hourSlot = '20h-24h';
      }
    }

    events.push({
      id: log.id,
      timestamp: log.timestampRFC3161,
      timeLabel,
      hourSlot,
      type: category,
      action: log.action,
      acteur: log.acteur,
      details: log.details,
      severity: category === 'UNAUTHORIZED_ACCESS' ? 'CRITIQUE' : 'HAUTE'
    });
  }

  return events;
}

/**
 * Calcule l'agrégation en Heatmap par tranche horaire et dérive les métriques de sécurité
 */
export function computeSecurityHeatmapMetrics(
  auditLogs: AuditEntry[],
  syntheticAttackCount: number = 0
): SecurityHeatmapMetrics {
  const events = extractSecurityEvents(auditLogs);

  // Initialisation des 6 buckets horaires
  const bucketMap: Record<string, HeatmapBucket> = {
    '00h-04h': { timeSlot: '00h-04h', rateLimitCount: 0, unauthorizedCount: 0, totalBlocked: 0, intensity: 0, dominantType: 'NONE', events: [] },
    '04h-08h': { timeSlot: '04h-08h', rateLimitCount: 0, unauthorizedCount: 0, totalBlocked: 0, intensity: 0, dominantType: 'NONE', events: [] },
    '08h-12h': { timeSlot: '08h-12h', rateLimitCount: 0, unauthorizedCount: 0, totalBlocked: 0, intensity: 0, dominantType: 'NONE', events: [] },
    '12h-16h': { timeSlot: '12h-16h', rateLimitCount: 0, unauthorizedCount: 0, totalBlocked: 0, intensity: 0, dominantType: 'NONE', events: [] },
    '16h-20h': { timeSlot: '16h-20h', rateLimitCount: 0, unauthorizedCount: 0, totalBlocked: 0, intensity: 0, dominantType: 'NONE', events: [] },
    '20h-24h': { timeSlot: '20h-24h', rateLimitCount: 0, unauthorizedCount: 0, totalBlocked: 0, intensity: 0, dominantType: 'NONE', events: [] }
  };

  let rateLimitTotal = 0;
  let unauthorizedTotal = 0;

  for (const ev of events) {
    const slot = bucketMap[ev.hourSlot] || bucketMap['12h-16h'];
    if (ev.type === 'RATE_LIMIT') {
      slot.rateLimitCount += 1;
      rateLimitTotal += 1;
    } else {
      slot.unauthorizedCount += 1;
      unauthorizedTotal += 1;
    }
    slot.totalBlocked += 1;
    slot.events.push(ev);
  }

  // Intégration du compteur de blocages synthétiques WAF s'il y a un décalage
  if (syntheticAttackCount > 0 && events.length < syntheticAttackCount) {
    const delta = syntheticAttackCount - events.length;
    // Répartir le delta sur les heures opérationnelles '08h-12h', '12h-16h', '16h-20h'
    const portionRate = Math.round(delta * 0.65);
    const portionUnauth = delta - portionRate;

    bucketMap['08h-12h'].rateLimitCount += Math.floor(portionRate * 0.3);
    bucketMap['08h-12h'].unauthorizedCount += Math.floor(portionUnauth * 0.3);
    bucketMap['08h-12h'].totalBlocked = bucketMap['08h-12h'].rateLimitCount + bucketMap['08h-12h'].unauthorizedCount;

    bucketMap['12h-16h'].rateLimitCount += Math.floor(portionRate * 0.4);
    bucketMap['12h-16h'].unauthorizedCount += Math.floor(portionUnauth * 0.4);
    bucketMap['12h-16h'].totalBlocked = bucketMap['12h-16h'].rateLimitCount + bucketMap['12h-16h'].unauthorizedCount;

    bucketMap['16h-20h'].rateLimitCount += portionRate - Math.floor(portionRate * 0.7);
    bucketMap['16h-20h'].unauthorizedCount += portionUnauth - Math.floor(portionUnauth * 0.7);
    bucketMap['16h-20h'].totalBlocked = bucketMap['16h-20h'].rateLimitCount + bucketMap['16h-20h'].unauthorizedCount;

    rateLimitTotal += portionRate;
    unauthorizedTotal += portionUnauth;
  }

  const buckets = Object.values(bucketMap);
  const maxSlotCount = Math.max(...buckets.map((b) => b.totalBlocked), 1);

  let peakSlot = '12h-16h';
  let peakCount = 0;

  for (const b of buckets) {
    b.intensity = Math.min(100, Math.round((b.totalBlocked / maxSlotCount) * 100));
    if (b.totalBlocked > peakCount) {
      peakCount = b.totalBlocked;
      peakSlot = b.timeSlot;
    }

    if (b.rateLimitCount === 0 && b.unauthorizedCount === 0) {
      b.dominantType = 'NONE';
    } else if (b.rateLimitCount > b.unauthorizedCount * 1.5) {
      b.dominantType = 'RATE_LIMIT';
    } else if (b.unauthorizedCount > b.rateLimitCount * 1.5) {
      b.dominantType = 'UNAUTHORIZED_ACCESS';
    } else {
      b.dominantType = 'BALANCED';
    }
  }

  const totalEvents = rateLimitTotal + unauthorizedTotal;
  const averagePerSlot = Math.round(totalEvents / buckets.length);

  let threatLevel: 'NOMINAL' | 'ELEVÉ' | 'CRITIQUE' = 'NOMINAL';
  if (totalEvents >= 10 || unauthorizedTotal >= 4) {
    threatLevel = 'CRITIQUE';
  } else if (totalEvents >= 4 || unauthorizedTotal >= 2) {
    threatLevel = 'ELEVÉ';
  }

  return {
    totalEvents,
    rateLimitTotal,
    unauthorizedTotal,
    peakSlot,
    peakCount,
    averagePerSlot,
    threatLevel,
    buckets,
    recentEvents: events.slice(0, 10)
  };
}
