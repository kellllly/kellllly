import { AuditEntry, BiometricLogMetadata } from '../types';

export interface BiometricAuditRecord {
  auditId: string;
  index: number;
  timestampRFC3161: string;
  actorMatricule: string;
  actorRoleNiveau: number;
  merkleLeafHash: string;
  rawDetails: string;
  status: 'SUCCESS' | 'FAILURE';
  actionType: string;
  actionTitle: string;
  targetResource: string;
  severity: 'BASSE' | 'MOYENNE' | 'HAUTE' | 'CRITIQUE' | 'TRES_SECRET';
  biometricMethod: string;
  authenticatorType: 'PLATFORM' | 'SECURITY_KEY' | 'PIN_BACKUP';
  userVerification: 'VERIFIED' | 'FAILED' | 'BYPASSED';
  credentialId: string;
  challengeHex: string;
  flags: {
    userPresent: boolean;
    userVerified: boolean;
    backupEligible: boolean;
    backupState: boolean;
  };
  signaturePreview: string;
  failureReason?: string;
  mitigationKEDB?: string;
}

export type BiometricStatusFilter = 'ALL' | 'SUCCESS' | 'FAILURE';

/**
 * Normalizes an audit entry into a BiometricAuditRecord if it represents a biometric or FIDO2 event.
 */
export function parseBiometricRecord(log: AuditEntry): BiometricAuditRecord | null {
  // 1. Direct structured metadata if present
  if (log.biometrie) {
    const b = log.biometrie;
    return {
      auditId: log.id,
      index: log.index,
      timestampRFC3161: log.timestampRFC3161,
      actorMatricule: log.acteur,
      actorRoleNiveau: log.roleNiveau,
      merkleLeafHash: log.hachageActuel,
      rawDetails: log.details,
      status: b.status,
      actionType: b.actionType,
      actionTitle: b.actionTitle,
      targetResource: b.targetResource,
      severity: b.severity,
      biometricMethod: b.biometricMethod || 'WebAuthn Platform',
      authenticatorType: b.authenticatorType || 'PLATFORM',
      userVerification: b.userVerification,
      credentialId: b.credentialId || `cred_${log.acteur.toLowerCase().replace(/[^a-z0-9]/g, '_')}_fido2`,
      challengeHex: b.challengeHex || log.hachageActuel.substring(0, 32),
      flags: {
        userPresent: b.flags?.userPresent ?? true,
        userVerified: b.flags?.userVerified ?? (b.status === 'SUCCESS'),
        backupEligible: b.flags?.backupEligible ?? true,
        backupState: b.flags?.backupState ?? false
      },
      signaturePreview: b.signaturePreview || `3045022100${log.hachageActuel.substring(0, 24)}...0220${log.hachagePrecedent.substring(0, 24)}`,
      failureReason: b.failureReason,
      mitigationKEDB: b.mitigationKEDB
    };
  }

  // 2. Synthesize from known action patterns in auditLogs
  const action = log.action.toUpperCase();
  const details = log.details;

  const isSuccessBiometric =
    action.includes('WEBAUTHN') ||
    action.includes('FIDO2') ||
    action === 'COMMUTATION_PRIVILEGE_WEBAUTHN' ||
    action === 'EXPORT_AUDIT_WORM_CSV_SIGNE' ||
    action === 'PURGE_CRYPTOGRAPHIQUE_WEBAUTHN' ||
    action === 'ESCALADE_CRISE_DECRET_48H_WEBAUTHN' ||
    action === 'WEBAUTHN_ASSERTION_VERIFIEE';

  const isFailedBiometric =
    action === 'UNAUTHORIZED_ACCESS_FIDO2' ||
    action === 'AUTH_ECHEC_PIN_INVALID' ||
    action === 'WEBAUTHN_ASSERTION_ECHEC' ||
    (action === 'ACCES_REFUSE_ZERO_KNOWLEDGE' && details.includes('FIDO'));

  if (!isSuccessBiometric && !isFailedBiometric) {
    return null;
  }

  const isSuccess = !isFailedBiometric;

  // Infer action type and title
  let actionType = 'VERIFY_ASSERTION';
  let actionTitle = 'Contrôle Biométrique FIDO2';
  let targetResource = 'Enclave Régalien Nkok';
  let severity: 'BASSE' | 'MOYENNE' | 'HAUTE' | 'CRITIQUE' | 'TRES_SECRET' = 'HAUTE';

  if (action.includes('COMMUTATION') || details.includes('Habilitation') || details.includes('Accréditation')) {
    actionType = 'SWITCH_HABILITATION';
    actionTitle = 'Élévation Privilège Habilitation';
    targetResource = 'Matrice ABAC & Habilitation';
    severity = 'CRITIQUE';
  } else if (action.includes('EXPORT') || details.includes('Export CSV') || details.includes('WORM')) {
    actionType = 'EXPORT_AUDIT_WORM';
    actionTitle = 'Download WORM Audit (Export CSV)';
    targetResource = 'Registre WORM (Merkle RFC 3161)';
    severity = 'CRITIQUE';
  } else if (action.includes('PURGE') || details.includes('RAM Zeroization') || details.includes('Clés')) {
    actionType = 'SHRED_SESSION_KEYS';
    actionTitle = 'Purge Mémoire RAM Zeroization';
    targetResource = 'Buffer Clés RAM (AES-256-GCM)';
    severity = 'CRITIQUE';
  } else if (action.includes('CRISE') || details.includes('Décret') || details.includes('48h')) {
    actionType = 'OPPOSITION_48H';
    actionTitle = 'Décret d\'Opposition Conservatoire 48h (Art. 29)';
    targetResource = 'Avoirs Sous Séquestre (1.45 Md FCFA)';
    severity = 'TRES_SECRET';
  }

  // Detect method used in details
  let biometricMethod = 'WebAuthn Platform (Touch ID / Face ID / Windows Hello)';
  let authenticatorType: 'PLATFORM' | 'SECURITY_KEY' | 'PIN_BACKUP' = 'PLATFORM';

  if (details.includes('YubiKey') || details.includes('Clé physique') || details.includes('Security Key')) {
    biometricMethod = 'FIDO2 Security Key (YubiKey 5 NFC)';
    authenticatorType = 'SECURITY_KEY';
  } else if (details.includes('PIN') || details.includes('secours')) {
    biometricMethod = 'Code PIN de secours Agent (SHA-256 KDF)';
    authenticatorType = 'PIN_BACKUP';
  }

  let failureReason: string | undefined;
  let mitigationKEDB: string | undefined;

  if (!isSuccess) {
    if (details.includes('révoqué') || details.includes('revoked')) {
      failureReason = 'Jeton matériel FIDO2 révoqué par le SOC Nkok (Compteur de signature désynchronisé)';
      mitigationKEDB = 'KEDB-042';
    } else if (details.includes('PIN erroné') || action.includes('PIN_INVALID')) {
      failureReason = 'Tentative d\'assertion avec code PIN erroné (Tentative bloquée)';
      mitigationKEDB = 'KEDB-SEC-09';
    } else {
      failureReason = details || 'Refus d\'assertion biométrique utilisateur (Annulation ou échec capteur)';
      mitigationKEDB = 'KEDB-042';
    }
  }

  return {
    auditId: log.id,
    index: log.index,
    timestampRFC3161: log.timestampRFC3161,
    actorMatricule: log.acteur,
    actorRoleNiveau: log.roleNiveau,
    merkleLeafHash: log.hachageActuel,
    rawDetails: log.details,
    status: isSuccess ? 'SUCCESS' : 'FAILURE',
    actionType,
    actionTitle,
    targetResource,
    severity,
    biometricMethod,
    authenticatorType,
    userVerification: isSuccess ? 'VERIFIED' : 'FAILED',
    credentialId: `cred_anif_${log.acteur.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${isSuccess ? 'auth' : 'rej'}`,
    challengeHex: log.hachageActuel.substring(0, 32),
    flags: {
      userPresent: true,
      userVerified: isSuccess,
      backupEligible: true,
      backupState: authenticatorType === 'PIN_BACKUP'
    },
    signaturePreview: isSuccess
      ? `3045022100${log.hachageActuel.substring(0, 24)}...0220${log.hachagePrecedent.substring(0, 24)}`
      : '000000000000000000000000000000000000000000000000 (SIGNATURE_REJETÉE)',
    failureReason,
    mitigationKEDB
  };
}

/**
 * Extracts and parses all biometric events from a general audit log.
 */
export function extractBiometricEvents(logs: AuditEntry[]): BiometricAuditRecord[] {
  const records: BiometricAuditRecord[] = [];
  for (const log of logs) {
    const record = parseBiometricRecord(log);
    if (record) {
      records.push(record);
    }
  }
  return records;
}

/**
 * Computes summary KPIs for biometric events.
 */
export function calculateBiometricStats(events: BiometricAuditRecord[]) {
  const total = events.length;
  const success = events.filter((e) => e.status === 'SUCCESS').length;
  const failure = events.filter((e) => e.status === 'FAILURE').length;
  const successRate = total > 0 ? Math.round((success / total) * 100) : 100;
  const platformCount = events.filter((e) => e.authenticatorType === 'PLATFORM').length;
  const securityKeyCount = events.filter((e) => e.authenticatorType === 'SECURITY_KEY').length;
  const pinCount = events.filter((e) => e.authenticatorType === 'PIN_BACKUP').length;

  return {
    total,
    success,
    failure,
    successRate: `${successRate}%`,
    platformCount,
    securityKeyCount,
    pinCount
  };
}

/**
 * Filters biometric records based on status, action type, and search queries.
 */
export function filterBiometricEvents(
  events: BiometricAuditRecord[],
  statusFilter: BiometricStatusFilter,
  actionFilter: string,
  searchQuery: string
): BiometricAuditRecord[] {
  const q = searchQuery.trim().toLowerCase();

  return events.filter((e) => {
    // Status filter
    if (statusFilter !== 'ALL' && e.status !== statusFilter) {
      return false;
    }

    // Action filter
    if (actionFilter !== 'ALL' && e.actionType !== actionFilter) {
      return false;
    }

    // Search query
    if (q) {
      const matchActor = e.actorMatricule.toLowerCase().includes(q);
      const matchTitle = e.actionTitle.toLowerCase().includes(q);
      const matchResource = e.targetResource.toLowerCase().includes(q);
      const matchCred = e.credentialId.toLowerCase().includes(q);
      const matchMethod = e.biometricMethod.toLowerCase().includes(q);
      const matchReason = e.failureReason ? e.failureReason.toLowerCase().includes(q) : false;
      const matchAuditId = e.auditId.toLowerCase().includes(q);

      if (!matchActor && !matchTitle && !matchResource && !matchCred && !matchMethod && !matchReason && !matchAuditId) {
        return false;
      }
    }

    return true;
  });
}
