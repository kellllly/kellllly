/**
 * ANIF Gabon - Sentinelle Autonome de Sécurité & Travailleur d'Arrière-Plan (Security Worker)
 * Surveillance continue du registre d'audit WORM (Audit Logs)
 * Détection des attaques par déni de service (Rate Limit) et accès non autorisés (Unauthorized Access)
 * Génération automatique de tickets d'incident majeurs ITSM P1 sous contrainte 48h
 */

import { AuditEntry, ItsmTicket } from '../types';

export type SecurityAnomalyType = 'RATE_LIMIT' | 'UNAUTHORIZED_ACCESS' | 'COMBINED_ATTACK';

export interface SecurityMonitorOptions {
  /** Nombre d'événements répétitifs requis pour déclencher l'alerte P1 (défaut: 3) */
  repetitionThreshold?: number;
  /** Fenêtre d'analyse dans les logs récents (défaut: 15 entrées) */
  inspectionWindow?: number;
  /** Délai minimal en millisecondes entre deux alertes similaires (défaut: 30000ms) */
  cooldownMs?: number;
}

export interface SecurityAnomalyDetection {
  detected: boolean;
  type: SecurityAnomalyType;
  count: number;
  offendingLogs: AuditEntry[];
  primaryActor: string;
  summary: string;
  anomalyKey: string;
}

// Regex de détection des événements d'accès non autorisés
const UNAUTHORIZED_ACCESS_REGEX = /(UNAUTHORIZED|ACCES_NON_AUTORISE|ACCES_REFUSE|AUTH_ECHEC|FIDO2_PIN_INVALID|FORBIDDEN|INTRUSION|WAF_XSS_SQLI)/i;

// Regex de détection des événements de dépassement de limite de débit (Rate Limiting)
const RATE_LIMIT_REGEX = /(RATE_LIMIT|DEBIT_DEPASSE|DDOS_BURST|TOO_MANY_REQUESTS|HTTP_429)/i;

/**
 * Identifie la catégorie de sécurité d'une action d'audit
 */
export function categorizeAuditSecurityAction(action: string): 'RATE_LIMIT' | 'UNAUTHORIZED_ACCESS' | null {
  if (RATE_LIMIT_REGEX.test(action)) {
    return 'RATE_LIMIT';
  }
  if (UNAUTHORIZED_ACCESS_REGEX.test(action)) {
    return 'UNAUTHORIZED_ACCESS';
  }
  return null;
}

/**
 * Analyse une liste d'entrées d'audit pour détecter des attaques répétitives
 */
export function detectSecurityAnomalies(
  logs: AuditEntry[],
  options: SecurityMonitorOptions = {}
): SecurityAnomalyDetection | null {
  const threshold = options.repetitionThreshold ?? 3;
  const windowSize = options.inspectionWindow ?? 15;

  if (!logs || logs.length === 0) return null;

  // Analyser les n entrées les plus récentes
  const recentLogs = logs.slice(0, windowSize);

  const rateLimitEvents: AuditEntry[] = [];
  const unauthorizedEvents: AuditEntry[] = [];

  for (const log of recentLogs) {
    const category = categorizeAuditSecurityAction(log.action);
    if (category === 'RATE_LIMIT') {
      rateLimitEvents.push(log);
    } else if (category === 'UNAUTHORIZED_ACCESS') {
      unauthorizedEvents.push(log);
    }
  }

  // 1. Détection attaque combinée (Rate Limit + Accès non autorisé)
  if (rateLimitEvents.length >= 2 && unauthorizedEvents.length >= 2) {
    const combinedLogs = [...rateLimitEvents, ...unauthorizedEvents];
    const key = `COMBINED_${combinedLogs[0]?.id}_${combinedLogs.length}`;
    return {
      detected: true,
      type: 'COMBINED_ATTACK',
      count: combinedLogs.length,
      offendingLogs: combinedLogs,
      primaryActor: combinedLogs[0]?.acteur || 'INTRUDEUR_INCONNU',
      summary: `Attaque cybernétique combinée : ${unauthorizedEvents.length} violations d'accès et ${rateLimitEvents.length} dépassements de débit WAF.`,
      anomalyKey: key
    };
  }

  // 2. Détection dépassement répétitif de débit (DDoS / Brute Force)
  if (rateLimitEvents.length >= threshold) {
    const key = `RATELIMIT_${rateLimitEvents[0]?.id}_${rateLimitEvents.length}`;
    return {
      detected: true,
      type: 'RATE_LIMIT',
      count: rateLimitEvents.length,
      offendingLogs: rateLimitEvents,
      primaryActor: rateLimitEvents[0]?.acteur || 'CLIENT_DDoS',
      summary: `Dépassement critique du seuil de débit WAF (Token Bucket épuisé à ${rateLimitEvents.length} reprises consécutives).`,
      anomalyKey: key
    };
  }

  // 3. Détection tentatives répétées d'accès non autorisé
  if (unauthorizedEvents.length >= threshold) {
    const key = `UNAUTH_${unauthorizedEvents[0]?.id}_${unauthorizedEvents.length}`;
    return {
      detected: true,
      type: 'UNAUTHORIZED_ACCESS',
      count: unauthorizedEvents.length,
      offendingLogs: unauthorizedEvents,
      primaryActor: unauthorizedEvents[0]?.acteur || 'AGENT_SUSPECT',
      summary: `Tentatives répétées (${unauthorizedEvents.length}) d'accès non autorisé, contournement Zero-Knowledge ou échec d'authentification biométrique.`,
      anomalyKey: key
    };
  }

  return null;
}

/**
 * Crée un ticket d'incident ITSM Haute Priorité P1 pour une anomalie détectée
 */
export function createSecurityAlertTicket(
  anomaly: SecurityAnomalyDetection,
  existingTicketsCount: number
): ItsmTicket {
  const now = new Date();
  const timeStr = now.toLocaleTimeString().substring(0, 5);
  const isoStr = now.toISOString();
  const ticketNum = 900 + (existingTicketsCount % 99);
  const id = `INC-2026-SEC-${ticketNum}`;

  let titre = '';
  if (anomaly.type === 'RATE_LIMIT') {
    titre = `[ALERTE SÉCURITÉ WAF] Dépassements de débit répétés (${anomaly.count} rejets Token Bucket / DDoS)`;
  } else if (anomaly.type === 'UNAUTHORIZED_ACCESS') {
    titre = `[ALERTE SÉCURITÉ WAF] Tentatives d'accès non autorisé répétées (${anomaly.count} violations)`;
  } else {
    titre = `[ALERTE SÉCURITÉ CRITIQUE] Attaque combinée détectée : Débit WAF et Accès non autorisé`;
  }

  // Formatage des détails des événements fautifs pour investigation forensique
  const eventsDetail = anomaly.offendingLogs
    .slice(0, 4)
    .map((l) => `• [${l.timestampRFC3161}] ${l.action} (Acteur: ${l.acteur}) : ${l.details}`)
    .join('\n');

  const descriptionAnonymisee = [
    `[DÉTECTION AUTOMATISÉE - SENTINELLE SSI DC NKOK TIER-III]`,
    anomaly.summary,
    `Acteur suspect identifié : ${anomaly.primaryActor}`,
    `Seuil de tolérance dépassé (${anomaly.count} occurrences détectées).`,
    `\nJOURNAL DES ÉVÉNEMENTS FORENSIQUES RÉCENTS :`,
    eventsDetail,
    `\nPROCÉDURE D'URGENCE REQUISE :`,
    `Application immédiate de l'article 29 GAFI (Isolation IP WAF, vérification du jeton FIDO2, escalade automatique auprès du Directeur Général).`
  ].join('\n');

  return {
    id,
    titre,
    descriptionAnonymisee,
    priorite: 'P1',
    statut: 'NOUVEAU',
    demandeurMatricule: 'SYSTEM-SENTINEL-WAF',
    demandeurNom: 'Sentinelle SSI Autonome (Nkok Tier-III)',
    stationSource: 'DC-NKOK-WAF-01',
    mttaMinutesMax: 15,
    mttrMinutesMax: 120,
    creeLe: timeStr,
    creeLeISO: isoStr,
    slaSecondesRestantes: 7200, // 2h SLA MTTR P1
    estEnEscalade: true,
    estSousContrainte48h: true,
    solutionKEDB: 'KEDB-SEC-09: Isoler l\'adresse IP source via le cluster WAF Nkok, révoquer la session active et forcer la réauthentification WebAuthn.'
  };
}

/**
 * Gestionnaire autonome d'état pour le Background Worker de surveillance
 */
export class SecurityMonitorWorker {
  private alertedAnomalyKeys = new Set<string>();
  private lastAlertTimestamp = 0;
  private options: SecurityMonitorOptions;

  constructor(options: SecurityMonitorOptions = {}) {
    this.options = options;
  }

  /**
   * Réinitialise les clés alertées (utile pour les tests ou après un cycle complet)
   */
  public reset(): void {
    this.alertedAnomalyKeys.clear();
    this.lastAlertTimestamp = 0;
  }

  /**
   * Traite les logs et retourne un nouveau ticket P1 si une anomalie non encore traitée est détectée
   */
  public inspectLogs(logs: AuditEntry[], existingTickets: ItsmTicket[]): ItsmTicket | null {
    const anomaly = detectSecurityAnomalies(logs, this.options);
    if (!anomaly || !anomaly.detected) {
      return null;
    }

    // Vérification du cooldown temporel
    const now = Date.now();
    const cooldown = this.options.cooldownMs ?? 15000;
    if (now - this.lastAlertTimestamp < cooldown && this.lastAlertTimestamp !== 0) {
      return null;
    }

    // Déduplication par clé d'anomalie
    if (this.alertedAnomalyKeys.has(anomaly.anomalyKey)) {
      return null;
    }

    // Vérifier si un ticket identique n'existe pas déjà dans la liste
    const alreadyExists = existingTickets.some(
      (t) =>
        t.priorite === 'P1' &&
        t.demandeurMatricule === 'SYSTEM-SENTINEL-WAF' &&
        t.titre.includes(anomaly.type === 'RATE_LIMIT' ? 'Dépassements de débit' : 'non autorisé') &&
        t.statut !== 'RESOLU' &&
        t.statut !== 'CLOS_KEDB'
    );

    if (alreadyExists) {
      return null;
    }

    // Enregistrement de la détection pour éviter tout doublon
    this.alertedAnomalyKeys.add(anomaly.anomalyKey);
    this.lastAlertTimestamp = now;

    return createSecurityAlertTicket(anomaly, existingTickets.length);
  }
}
