export type AccreditationLevel = 1 | 2 | 3 | 4 | 5;

export interface UserProfile {
  id: string;
  matricule: string;
  nom: string;
  titre: string;
  roleNiveau: AccreditationLevel;
  roleLibelle: string;
  habilitation: 'TRES_SECRET' | 'CONFIDENTIEL' | 'SSI_ADMIN' | 'RESTREINT' | 'AUDITEUR_EXTERNE';
  badgeColor: string;
  fingerprintFIDO: string;
  stationIP: string;
}

export type ChannelType = 'dos' | 'general' | 'it' | 'ephemere';

export interface Channel {
  id: string;
  code: string;
  nom: string;
  type: ChannelType;
  classificationRequise: AccreditationLevel;
  description: string;
  e2eeProtocol: string;
  estScelle: boolean;
  retentionHours: number;
}

export interface EncryptedMessage {
  id: string;
  canalId: string;
  auteur: string;
  matricule: string;
  roleNiveau: AccreditationLevel;
  texteClair: string;
  chiffreHex: string;
  ivHex: string;
  tagHex: string;
  timestamp: string;
  timestampRFC3161: string;
  classification: string;
  pieceJointe?: {
    nom: string;
    taille: string;
    sha256: string;
  };
  estEphemere?: boolean;
}

export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type TicketStatus = 'NOUVEAU' | 'ASSIGNE_L1' | 'ESCALADE_L2' | 'EXPERTISE_L3' | 'RESOLU' | 'CLOS_KEDB';

export interface ItsmTicket {
  id: string;
  titre: string;
  descriptionAnonymisee: string;
  priorite: TicketPriority;
  statut: TicketStatus;
  demandeurMatricule: string;
  demandeurNom: string;
  technicienAssigne?: string;
  stationSource: string;
  mttaMinutesMax: number;
  mttrMinutesMax: number;
  creeLe: string;
  creeLeISO: string;
  slaSecondesRestantes: number;
  estEnEscalade: boolean;
  estSousContrainte48h: boolean;
  solutionKEDB?: string;
}

export interface BiometricLogMetadata {
  status: 'SUCCESS' | 'FAILURE';
  actionType: string;
  actionTitle: string;
  targetResource: string;
  severity: 'BASSE' | 'MOYENNE' | 'HAUTE' | 'CRITIQUE' | 'TRES_SECRET';
  biometricMethod?: string;
  authenticatorType?: 'PLATFORM' | 'SECURITY_KEY' | 'PIN_BACKUP';
  userVerification: 'VERIFIED' | 'FAILED' | 'BYPASSED';
  credentialId?: string;
  challengeHex?: string;
  flags?: {
    userPresent: boolean;
    userVerified: boolean;
    backupEligible?: boolean;
    backupState?: boolean;
  };
  signaturePreview?: string;
  failureReason?: string;
  mitigationKEDB?: string;
}

export interface AuditEntry {
  index: number;
  id: string;
  timestampRFC3161: string;
  action: string;
  acteur: string;
  roleNiveau: AccreditationLevel;
  details: string;
  hachagePrecedent: string;
  hachageActuel: string;
  estValide?: boolean;
  biometrie?: BiometricLogMetadata;
}

export interface BotMessage {
  id: string;
  emetteur: 'bot' | 'utilisateur';
  contenu: string;
  timestamp: string;
  telemetrie?: {
    cible?: string;
    latenceMs?: number;
    statut?: 'NOMINAL' | 'ALERTE' | 'OPTIMAL';
    rpo?: string;
    rto?: string;
  };
}

export interface KedbArticle {
  id: string;
  codeErreur: string;
  titre: string;
  composant: string;
  symptome: string;
  contournement: string;
  resolutionDefinitive: string;
}
