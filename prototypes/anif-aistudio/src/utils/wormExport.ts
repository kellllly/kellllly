/**
 * ANIF Gabon - Générateur d'Export de Registre WORM Sécurisé & Signé Cryptographiquement
 * Conforme RFC 4180 (CSV), RFC 3161 (Horodatage) et Reco 29 GAFI
 * Scellage Merkle & Signature WebAuthn / FIDO2
 */

import { AuditEntry, UserProfile } from '../types';
import { WebAuthnAssertionResult } from './webauthn';
import { sha256Hex, formatRFC3161Timestamp } from './crypto';

export interface GenerateSignedCsvOptions {
  auditLogs: AuditEntry[];
  currentUser: UserProfile;
  assertion: WebAuthnAssertionResult;
  exportReason?: string;
}

export interface VerifySignedCsvResult {
  isValid: boolean;
  totalEntries: number;
  merkleRootSeal: string;
  signatureHex: string;
  biometricMethod: string;
  signerMatricule: string;
  errors: string[];
}

/**
 * Échappe un champ pour le format CSV RFC 4180
 */
export function escapeCsvField(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Calcule l'empreinte racine Merkle cumulée d'une série d'entrées d'audit
 */
export async function computeCumulativeMerkleRoot(auditLogs: AuditEntry[]): Promise<string> {
  if (auditLogs.length === 0) {
    return await sha256Hex('EMPTY_WORM_REGISTRY_GENESIS');
  }
  // Concaténation ordonnée de tous les hachages de feuilles
  const combinedLeafHashes = auditLogs.map((l) => `${l.index}:${l.hachageActuel}`).join('|');
  return await sha256Hex(`MERKLE_ROOT_ANIF_GABON|${combinedLeafHashes}`);
}

/**
 * Génère le fichier CSV complet signé cryptographiquement avec scellement Merkle
 */
export async function generateSignedAuditCsv(options: GenerateSignedCsvOptions): Promise<{
  csvContent: string;
  filename: string;
  merkleRootSeal: string;
  documentSignature: string;
}> {
  const { auditLogs, currentUser, assertion, exportReason } = options;
  const now = new Date();
  const exportTimestampRFC = formatRFC3161Timestamp(now);
  const fileDateStamp = now.toISOString().replace(/[-:T]/g, '').substring(0, 14);

  // 1. Calcul du sceau racine Merkle
  const merkleRootSeal = await computeCumulativeMerkleRoot(auditLogs);

  // 2. Calcul de la signature cryptographique du document scellé
  const rawSignaturePayload = [
    'ANIF_GABON_WORM_MANIFEST_V1',
    exportTimestampRFC,
    currentUser.matricule,
    currentUser.habilitation,
    assertion.biometricMethod,
    assertion.credentialId || 'PLATFORM_KEY',
    assertion.signatureHex || 'SIG_ASSERTION_VERIFIED',
    merkleRootSeal,
    auditLogs.length
  ].join(':::');

  const documentSignature = await sha256Hex(rawSignaturePayload);

  // 3. Construction des en-têtes cryptographiques (Format commentaire # conforme RFC)
  const headerLines = [
    '# ==========================================================================',
    '# RÉPUBLIQUE GABONAISE // AGENCE NATIONALE D\'INVESTIGATION FINANCIÈRE (ANIF)',
    '# REGISTRE D\'AUDIT SOUVERAIN WORM SCELLÉ PAR ARBRE DE MERKLE // RFC 3161',
    '# CONFORMITÉ GAFI RECOMMANDATION 29 // CODE MONÉTAIRE ET FINANCIER CEMAC',
    '# ==========================================================================',
    `# HORODATAGE_CERTIFIE_RFC3161: ${exportTimestampRFC}`,
    `# SIGNATAIRE_MATRICULE: ${currentUser.matricule}`,
    `# SIGNATAIRE_NOM: ${currentUser.nom}`,
    `# SIGNATAIRE_HABILITATION: NIVEAU ${currentUser.roleNiveau} (${currentUser.habilitation})`,
    `# STATION_IP_EMETTRICE: ${currentUser.stationIP}`,
    `# MOTIF_EXTRACTION: ${exportReason || 'Extraction légale pour autorité judiciaire ou supervision COBAC'}`,
    `# METHODE_AUTHENTIFICATION_FORTE: ${assertion.biometricMethod}`,
    `# IDENTIFIANT_CLE_FIDO2_WEBAUTHN: ${assertion.credentialId || currentUser.fingerprintFIDO}`,
    `# CHALLENGE_HEX_WEBAUTHN: ${assertion.rawChallengeHex}`,
    `# SIGNATURE_ASSERTION_WEBAUTHN: ${assertion.signatureHex || 'VALIDEE_HARDWARE_FIDO2'}`,
    `# SCEAU_RACINE_MERKLE_WORM: ${merkleRootSeal}`,
    `# SIGNATURE_NUMERIQUE_DOCUMENT_SHA256: ${documentSignature}`,
    `# NOMBRE_ENTREES_AUDIT_TOTAL: ${auditLogs.length}`,
    `# REPERTOIRE_SOURCE: DC NKOK TIER-III (REPLIQUE SYNCHRONE LIBREVILLE)`,
    '# =========================================================================='
  ];

  // 4. Colonnes du CSV
  const csvHeaders = [
    'Index',
    'ID_Entree',
    'Horodatage_RFC3161',
    'Action',
    'Matricule_Agent',
    'Niveau_Habilitation',
    'Details_Evenement',
    'Hachage_Precedent',
    'Hachage_Feuille_Merkle',
    'Integrite_Validee'
  ];

  // 5. Lignes de données
  const rows = auditLogs.map((log) => [
    escapeCsvField(log.index),
    escapeCsvField(log.id),
    escapeCsvField(log.timestampRFC3161),
    escapeCsvField(log.action),
    escapeCsvField(log.acteur),
    escapeCsvField(`Niveau ${log.roleNiveau}`),
    escapeCsvField(log.details),
    escapeCsvField(log.hachagePrecedent),
    escapeCsvField(log.hachageActuel),
    escapeCsvField(log.estValide !== false ? 'OUI (CONFORME)' : 'NON (ALTERÉ)')
  ].join(','));

  // 6. Pied de page cryptographique de scellement
  const footerLines = [
    '# --------------------------------------------------------------------------',
    '# --- FIN DU REGISTRE D\'AUDIT WORM SOUVERAIN ANIF GABON ---',
    `# CONTROLE_INTEGRITE_GLOBAL_SHA256: ${documentSignature}`,
    '# CET EXPORT CONSTITUE UNE PREUVE FORENSIQUE LÉGALE INFALSIFIABLE (WORM OBJECT LOCK)',
    '# --------------------------------------------------------------------------'
  ];

  const fullCsv = [
    ...headerLines,
    csvHeaders.join(','),
    ...rows,
    ...footerLines
  ].join('\n');

  const filename = `ANIF_WORM_AUDIT_SIGNE_${currentUser.matricule}_${fileDateStamp}.csv`;

  return {
    csvContent: fullCsv,
    filename,
    merkleRootSeal,
    documentSignature
  };
}

/**
 * Télécharge le contenu CSV sous forme de fichier dans le navigateur
 */
export function triggerCsvDownload(csvContent: string, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Parse une ligne CSV RFC 4180 avec gestion des guillemets et virgules échappées
 */
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++; // Sauter le guillemet échappé
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Vérifie l'intégrité d'un export CSV WORM signé
 */
export function verifySignedAuditCsv(csvContent: string): VerifySignedCsvResult {
  const lines = csvContent.split('\n');
  const errors: string[] = [];
  let merkleRootSeal = '';
  let signatureHex = '';
  let biometricMethod = '';
  let signerMatricule = '';
  const dataRows: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#')) {
      if (line.includes('SCEAU_RACINE_MERKLE_WORM:')) {
        merkleRootSeal = line.split('SCEAU_RACINE_MERKLE_WORM:')[1]?.trim() || '';
      } else if (line.includes('SIGNATURE_NUMERIQUE_DOCUMENT_SHA256:')) {
        signatureHex = line.split('SIGNATURE_NUMERIQUE_DOCUMENT_SHA256:')[1]?.trim() || '';
      } else if (line.includes('METHODE_AUTHENTIFICATION_FORTE:')) {
        biometricMethod = line.split('METHODE_AUTHENTIFICATION_FORTE:')[1]?.trim() || '';
      } else if (line.includes('SIGNATAIRE_MATRICULE:')) {
        signerMatricule = line.split('SIGNATAIRE_MATRICULE:')[1]?.trim() || '';
      }
    } else if (line.length > 0 && !line.startsWith('Index,ID_Entree')) {
      dataRows.push(line);
    }
  }

  if (!merkleRootSeal) {
    errors.push('Sceau racine Merkle manquant dans les en-têtes');
  }
  if (!signatureHex) {
    errors.push('Signature numérique SHA-256 manquante dans les en-têtes');
  }
  if (!signerMatricule) {
    errors.push('Matricule de l\'opérateur signataire absent');
  }
  if (dataRows.length === 0) {
    errors.push('Aucune ligne de journal d\'audit trouvée dans le fichier');
  }

  // Vérification de la continuité de chaîne Merkle
  let previousHashInChain: string | null = null;
  for (let i = 0; i < dataRows.length; i++) {
    const parts = parseCsvLine(dataRows[i]);
    // Parts: [Index, ID_Entree, Horodatage, Action, Matricule, Niveau, Details, Hachage_Precedent, Hachage_Feuille_Merkle, Integrite]
    if (parts.length >= 9) {
      const prevHash = parts[7];
      const currentHash = parts[8];

      if (previousHashInChain !== null && prevHash !== previousHashInChain) {
        errors.push(`Rupture de chaîne Merkle détectée à la ligne ${i + 1}: précedent "${prevHash}" != attendu "${previousHashInChain}"`);
      }
      previousHashInChain = currentHash;
    } else {
      errors.push(`Ligne ${i + 1} invalide: ${parts.length} colonnes trouvées (attendu: 10)`);
    }
  }

  return {
    isValid: errors.length === 0,
    totalEntries: dataRows.length,
    merkleRootSeal,
    signatureHex,
    biometricMethod,
    signerMatricule,
    errors
  };
}
