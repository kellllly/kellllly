import {
  UserProfile,
  Channel,
  EncryptedMessage,
  ItsmTicket,
  AuditEntry,
  KedbArticle
} from '../types';

export const ACCREDITATION_PROFILES: Record<number, UserProfile> = {
  1: {
    id: 'USR-001',
    matricule: 'AGT-DG-001',
    nom: 'Col. Léon Mba',
    titre: 'Directeur Général & Magistrat Délégué',
    roleNiveau: 1,
    roleLibelle: 'Niveau 1 : Direction Générale & Magistrature',
    habilitation: 'TRES_SECRET',
    badgeColor: 'border-amber-500/50 text-amber-300 bg-amber-950/40',
    fingerprintFIDO: 'FIDO2-GAB-992-SEC',
    stationIP: '10.24.1.10 (Enclave Présidence)'
  },
  2: {
    id: 'USR-042',
    matricule: 'AGT-AN-042',
    nom: 'Marcelle Nguema',
    titre: 'Analyste Financier Senior (Opérationnel)',
    roleNiveau: 2,
    roleLibelle: 'Niveau 2 : Analyste Financier Senior',
    habilitation: 'CONFIDENTIEL',
    badgeColor: 'border-emerald-500/50 text-emerald-300 bg-emerald-950/40',
    fingerprintFIDO: 'FIDO2-GAB-441-ANL',
    stationIP: '10.24.1.88 (Salle des Enquêtes)'
  },
  3: {
    id: 'USR-103',
    matricule: 'AGT-SSI-103',
    nom: 'Borel Koumba',
    titre: 'Administrateur Systèmes & SSI (Support)',
    roleNiveau: 3,
    roleLibelle: 'Niveau 3 : Administrateur SSI & Support',
    habilitation: 'SSI_ADMIN',
    badgeColor: 'border-blue-500/50 text-blue-300 bg-blue-950/40',
    fingerprintFIDO: 'FIDO2-GAB-103-SYS',
    stationIP: '10.24.2.15 (SOC / NOC Nkok)'
  },
  4: {
    id: 'USR-204',
    matricule: 'AGT-AP-204',
    nom: 'Sophie Mvele',
    titre: 'Agent Services d\'Appui & Logistique',
    roleNiveau: 4,
    roleLibelle: 'Niveau 4 : Services d\'Appui (Restreint)',
    habilitation: 'RESTREINT',
    badgeColor: 'border-slate-500/50 text-slate-300 bg-slate-900',
    fingerprintFIDO: 'FIDO2-GAB-204-APP',
    stationIP: '10.24.3.50 (Bureautique)'
  },
  5: {
    id: 'USR-505',
    matricule: 'AUD-GABAC-09',
    nom: 'Inspecteur Patrice Obiang',
    titre: 'Superviseur GABAC / Groupe Egmont',
    roleNiveau: 5,
    roleLibelle: 'Niveau 5 : Auditeur Externe Régional',
    habilitation: 'AUDITEUR_EXTERNE',
    badgeColor: 'border-purple-500/50 text-purple-300 bg-purple-950/40',
    fingerprintFIDO: 'FIDO2-EXT-908-CEMAC',
    stationIP: '10.24.99.12 (Tunnel VPN Isolé)'
  }
};

export const CHANNELS: Channel[] = [
  {
    id: 'dos-bgf',
    code: 'DOS-2026-BGF-089',
    nom: 'Enquête Prioritaire BGF-089 (Flux Transfrontaliers)',
    type: 'dos',
    classificationRequise: 2,
    description: 'Investigation sous le sceau de l\'article 29 - Soupçon de blanchiment et transferts occultes CEMAC/Europe',
    e2eeProtocol: 'Double Ratchet X25519 + AES-256-GCM',
    estScelle: true,
    retentionHours: 24
  },
  {
    id: 'dos-min',
    code: 'DOS-2026-MIN-014',
    nom: 'Dossier Minerais & Exploitations Minières Haut-Ogooué',
    type: 'dos',
    classificationRequise: 2,
    description: 'Circuit financier parallèle sur concessions d\'or et manganèse - Communication restreinte DG & Analystes',
    e2eeProtocol: 'Double Ratchet X25519 + AES-256-GCM',
    estScelle: true,
    retentionHours: 48
  },
  {
    id: 'general',
    code: 'CANAL-INSTITUTIONNEL',
    nom: 'Diffusion Générale & Directives de Service',
    type: 'general',
    classificationRequise: 4,
    description: 'Circulaires internes, notes de la Direction et coordination administrative des services',
    e2eeProtocol: 'Chiffrement d\'infrastructure TLS 1.3 + Chaînage WORM',
    estScelle: false,
    retentionHours: 720
  },
  {
    id: 'it',
    code: 'SUPPORT-TECHNIQUE-SSI',
    nom: 'Assistance Technique & Exploitation Nkok',
    type: 'it',
    classificationRequise: 4,
    description: 'Canal d\'échange sécurisé avec les ingénieurs SSI du Data Center de Nkok pour incidents applicatifs',
    e2eeProtocol: 'Chiffrement Authentifié End-to-End',
    estScelle: false,
    retentionHours: 168
  }
];

export const INITIAL_MESSAGES: Record<string, EncryptedMessage[]> = {
  'dos-bgf': [
    {
      id: 'MSG-001',
      canalId: 'dos-bgf',
      auteur: 'Col. Léon Mba (DG)',
      matricule: 'AGT-DG-001',
      roleNiveau: 1,
      texteClair: 'Diligentez immédiatement l\'analyse sur les flux transfrontaliers suspects signalés par la COBAC sur le compte GA2100010002000300040005001. Gel conservatoire sous 48h requis.',
      chiffreHex: '8f4c1e0b92a4773d19e048123af8bb90192a54ceb847',
      ivHex: '4a1b89ef01c238fa9012beef',
      tagHex: '91fe3302bc56aa71',
      timestamp: '19:42',
      timestampRFC3161: '2026-11-07 19:42:15 UTC [RFC 3161]',
      classification: 'TRÈS SECRET // ARTICLE 29',
      pieceJointe: {
        nom: 'Requisition_COBAC_BGF88.pdf.enc',
        taille: '2.4 Mo',
        sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
      }
    },
    {
      id: 'MSG-002',
      canalId: 'dos-bgf',
      auteur: 'Marcelle Nguema (Analyste)',
      matricule: 'AGT-AN-042',
      roleNiveau: 2,
      texteClair: 'Reçu mon Colonel. Détection de 3 virements fractionnés totalisant 1 450 000 000 FCFA vers une société holding à Dubaï. Ordonnance de blocage préparée pour le magistrat délégué.',
      chiffreHex: 'e719c83250bb7f901a55cc8912eef431ab009148d21b',
      ivHex: 'c80145efab901234771190bc',
      tagHex: 'a441bb8709caee12',
      timestamp: '19:50',
      timestampRFC3161: '2026-11-07 19:50:30 UTC [RFC 3161]',
      classification: 'CONFIDENTIEL OPÉRATIONNEL'
    },
    {
      id: 'MSG-003',
      canalId: 'dos-bgf',
      auteur: 'Marcelle Nguema (Analyste)',
      matricule: 'AGT-AN-042',
      roleNiveau: 2,
      texteClair: 'Alerte technique : Nous constatons des coupures intermittentes de la liaison réseau vers la base de données Nkok lors du traitement du lot de transactions NIF 994821-GA.',
      chiffreHex: '33bb19a400cc78efb224194098aa12c0194883bbfe88',
      ivHex: '551109aacc88471209bc3311',
      tagHex: 'ee1209bca7889120',
      timestamp: '20:05',
      timestampRFC3161: '2026-11-07 20:05:12 UTC [RFC 3161]',
      classification: 'CONFIDENTIEL OPÉRATIONNEL'
    }
  ],
  'dos-min': [
    {
      id: 'MSG-010',
      canalId: 'dos-min',
      auteur: 'Col. Léon Mba (DG)',
      matricule: 'AGT-DG-001',
      roleNiveau: 1,
      texteClair: 'Coordination activée avec le Procureur Spécial. Les déclarations de soupçon transmises par la Direction Générale des Mines font état de paiements en devises non rapatriés (12 000 000 USD).',
      chiffreHex: '67a809bcae710034bcefa81023901aef441098bca120',
      ivHex: '990011aacc4578120955bb44',
      tagHex: '12ef44bc0988aa11',
      timestamp: '17:15',
      timestampRFC3161: '2026-11-07 17:15:00 UTC [RFC 3161]',
      classification: 'TRÈS SECRET'
    }
  ],
  'general': [
    {
      id: 'MSG-020',
      canalId: 'general',
      auteur: 'Sophie Mvele (Services d\'Appui)',
      matricule: 'AGT-AP-204',
      roleNiveau: 4,
      texteClair: 'Rappel à l\'ensemble des agents : Renouvellement annuel des certificats matériels FIDO2 YubiKey ce vendredi à 14h en salle polyvalente.',
      chiffreHex: '19ef00ca891147bcee4510bc334419a4',
      ivHex: '11223344556677889900aabb',
      tagHex: 'ccddeeff00112233',
      timestamp: '14:30',
      timestampRFC3161: '2026-11-07 14:30:00 UTC [RFC 3161]',
      classification: 'INTERNE'
    }
  ],
  'it': [
    {
      id: 'MSG-030',
      canalId: 'it',
      auteur: 'Marcelle Nguema (Analyste)',
      matricule: 'AGT-AN-042',
      roleNiveau: 2,
      texteClair: 'Ingénieur SSI : Latence inhabituelle (> 380ms) constatée sur le cluster S3 MinIO lors de l\'exportation des scellés numériques d\'investigation.',
      chiffreHex: '8877665544332211aabbccddeeff0011',
      ivHex: 'aabbccddeeff001122334455',
      tagHex: '66778899aabbccdd',
      timestamp: '20:10',
      timestampRFC3161: '2026-11-07 20:10:45 UTC [RFC 3161]',
      classification: 'SUPPORT TECHNIQUE'
    },
    {
      id: 'MSG-031',
      canalId: 'it',
      auteur: 'Borel Koumba (Admin SSI)',
      matricule: 'AGT-SSI-103',
      roleNiveau: 3,
      texteClair: 'Reçu Marcelle. Diagnostic en cours sur la route optique Libreville-Nkok. Le basculement vers le lien secours ZES Nkok est prêt si nécessaire.',
      chiffreHex: '9900aabbccddeeff1122334455667788',
      ivHex: '1234567890abcdef12345678',
      tagHex: 'fedcba0987654321',
      timestamp: '20:12',
      timestampRFC3161: '2026-11-07 20:12:10 UTC [RFC 3161]',
      classification: 'SUPPORT TECHNIQUE'
    }
  ]
};

export const INITIAL_TICKETS: ItsmTicket[] = [
  {
    id: 'INC-2026-081',
    titre: 'Latence synchronisation liaison Nkok - BDD DOS',
    descriptionAnonymisee: '[Extrait Passerelle Sécurisée] Coupures intermittentes lors de la synchronisation de données transactionnelles avec le Data Center Nkok Tier III. Poste source: TERM-ANIF-LIB-884.',
    priorite: 'P1',
    statut: 'EXPERTISE_L3',
    demandeurMatricule: 'AGT-AN-042',
    demandeurNom: 'Marcelle Nguema',
    technicienAssigne: 'Borel Koumba (Ingénieur SSI)',
    stationSource: '10.24.1.88',
    mttaMinutesMax: 15,
    mttrMinutesMax: 120, // 2h
    creeLe: '20:12',
    creeLeISO: '2026-11-07T20:12:00Z',
    slaSecondesRestantes: 6850, // ~ 1h54m
    estEnEscalade: false,
    estSousContrainte48h: true,
    solutionKEDB: 'Basculer la route BGP vers l\'anneau optique Ouest ZES Nkok et purger le cache Redis'
  },
  {
    id: 'INC-2026-082',
    titre: 'Échec régénération token matériel FIDO2 analyste',
    descriptionAnonymisee: 'Clé YubiKey FIDO2 désynchronisée suite à 3 tentatives infructueuses sur station d\'analyse 4. Révocation et réenrôlement requis.',
    priorite: 'P3',
    statut: 'ASSIGNE_L1',
    demandeurMatricule: 'AGT-AN-104',
    demandeurNom: 'Patrick Nzé',
    technicienAssigne: 'Helpdesk Niveaux 1',
    stationSource: '10.24.1.92',
    mttaMinutesMax: 120,
    mttrMinutesMax: 480, // 8h
    creeLe: '18:30',
    creeLeISO: '2026-11-07T18:30:00Z',
    slaSecondesRestantes: 22100,
    estEnEscalade: false,
    estSousContrainte48h: false
  },
  {
    id: 'INC-2026-083',
    titre: 'Blocage compartiment MinIO S3 chiffré - Export scellés',
    descriptionAnonymisee: 'Impossibilité d\'extraire les archives chiffrées pour transmission au magistrat instructeur. Code erreur 403 S3: SignatureDoesNotMatch.',
    priorite: 'P2',
    statut: 'ESCALADE_L2',
    demandeurMatricule: 'AGT-AN-042',
    demandeurNom: 'Marcelle Nguema',
    technicienAssigne: 'Cellule Infrastructure SSI',
    stationSource: '10.24.1.88',
    mttaMinutesMax: 30,
    mttrMinutesMax: 240, // 4h
    creeLe: '19:15',
    creeLeISO: '2026-11-07T19:15:00Z',
    slaSecondesRestantes: 11400,
    estEnEscalade: false,
    estSousContrainte48h: true
  },
  {
    id: 'INC-2026-084',
    titre: 'Demande ouverture compartiment audit GABAC / Egmont',
    descriptionAnonymisee: 'Attribution de droits de consultation temporaires sur les métadonnées d\'audit pour l\'inspecteur régional.',
    priorite: 'P4',
    statut: 'NOUVEAU',
    demandeurMatricule: 'AUD-GABAC-09',
    demandeurNom: 'Inspecteur Patrice Obiang',
    stationSource: '10.24.99.12',
    mttaMinutesMax: 240,
    mttrMinutesMax: 2880, // 48h
    creeLe: '16:00',
    creeLeISO: '2026-11-07T16:00:00Z',
    slaSecondesRestantes: 154000,
    estEnEscalade: false,
    estSousContrainte48h: false
  }
];

export const INITIAL_AUDIT_LOGS: AuditEntry[] = [
  {
    index: 1,
    id: 'AUD-2026-0001',
    timestampRFC3161: '2026-11-07 19:40:02 UTC [RFC 3161]',
    action: 'INITIALISATION_CLUSTER_NKOK',
    acteur: 'SYSTEM-DAEMON',
    roleNiveau: 3,
    details: 'Démarrage du quorum Raft NATS JetStream (3 répliques) sur nœud Nkok Tier III',
    hachagePrecedent: '0000000000000000000000000000000000000000000000000000000000000000',
    hachageActuel: '7f8a12c93b44e0192a54ceb84791fe3302bc56aa71a441bb8709caee129033bb',
    estValide: true
  },
  {
    index: 2,
    id: 'AUD-2026-0002',
    timestampRFC3161: '2026-11-07 19:42:15 UTC [RFC 3161]',
    action: 'MESSAGE_CHIFFRE_CANAL_SCELLÉ',
    acteur: 'AGT-DG-001',
    roleNiveau: 1,
    details: 'Envoi message crypté AES-GCM sur #DOS-2026-BGF-089 avec pièce jointe chiffrée',
    hachagePrecedent: '7f8a12c93b44e0192a54ceb84791fe3302bc56aa71a441bb8709caee129033bb',
    hachageActuel: '4fa8710b2c1189bc00192a54ceb84791fe3302bc56aa71a441bb8709caee1290',
    estValide: true
  },
  {
    index: 3,
    id: 'AUD-2026-0003',
    timestampRFC3161: '2026-11-07 20:12:05 UTC [RFC 3161]',
    action: 'INCIDENT_ITSM_CRITIQUE_P1',
    acteur: 'AGT-AN-042',
    roleNiveau: 2,
    details: 'Création ticket INC-2026-081 (Latence Nkok) sous contrainte légale 48h (Art. 29 GAFI)',
    hachagePrecedent: '4fa8710b2c1189bc00192a54ceb84791fe3302bc56aa71a441bb8709caee1290',
    hachageActuel: 'c940bfa192a54ceb84791fe3302bc56aa71a441bb8709caee129033bb8f4c1e0',
    estValide: true
  },
  {
    index: 4,
    id: 'AUD-2026-0004',
    timestampRFC3161: '2026-11-08 08:15:22 UTC [RFC 3161]',
    action: 'COMMUTATION_PRIVILEGE_WEBAUTHN',
    acteur: 'AGT-DG-001',
    roleNiveau: 1,
    details: 'Accréditation Niveau 1 (Col. Léon Mba) débloquée via biométrie WebAuthn (Touch ID / Apple Silicon Secure Enclave)',
    hachagePrecedent: 'c940bfa192a54ceb84791fe3302bc56aa71a441bb8709caee129033bb8f4c1e0',
    hachageActuel: 'e81290bb33aa4fa8710b2c1189bc00192a54ceb84791fe3302bc56aa71a441bb',
    estValide: true,
    biometrie: {
      status: 'SUCCESS',
      actionType: 'SWITCH_HABILITATION',
      actionTitle: 'Élévation Privilège : Direction Générale & Magistrature',
      targetResource: 'Niveau 1 : Col. Léon Mba',
      severity: 'TRES_SECRET',
      biometricMethod: 'WebAuthn Platform Authenticator (Touch ID)',
      authenticatorType: 'PLATFORM',
      userVerification: 'VERIFIED',
      credentialId: 'cred_anif_gab_992_sec',
      challengeHex: '7f9104ca88bb4421eed0912beefc91a0',
      flags: {
        userPresent: true,
        userVerified: true,
        backupEligible: true,
        backupState: false
      },
      signaturePreview: '30450221008f1c4a9900bb1122...0220e81290bb33aa4fa8710b2c'
    }
  },
  {
    index: 5,
    id: 'AUD-2026-0005',
    timestampRFC3161: '2026-11-08 11:42:10 UTC [RFC 3161]',
    action: 'UNAUTHORIZED_ACCESS_FIDO2',
    acteur: 'AGT-AP-204',
    roleNiveau: 4,
    details: 'Échec d\'authentification biométrique pour Purge Mémoire Vive (RAM Zeroization) : Code PIN FIDO2 erroné (3 tentatives infructueuses)',
    hachagePrecedent: 'e81290bb33aa4fa8710b2c1189bc00192a54ceb84791fe3302bc56aa71a441bb',
    hachageActuel: '19bc00192a54ceb84791fe3302bc56aa71a441bbf8a12c93b44e0192a54ceb84',
    estValide: true,
    biometrie: {
      status: 'FAILURE',
      actionType: 'SHRED_SESSION_KEYS',
      actionTitle: 'Purge Mémoire Vive (RAM Zeroization)',
      targetResource: 'Buffer Clés RAM (AES-256-GCM)',
      severity: 'CRITIQUE',
      biometricMethod: 'FIDO2 Security Key (YubiKey 5 NFC)',
      authenticatorType: 'SECURITY_KEY',
      userVerification: 'FAILED',
      credentialId: 'cred_anif_gab_204_app',
      challengeHex: '0a98ef1234bc567890abcdef12345678',
      flags: {
        userPresent: true,
        userVerified: false,
        backupEligible: true,
        backupState: false
      },
      signaturePreview: '00000000000000000000000000000000 (SIGNATURE_REJETÉE)',
      failureReason: 'AUTH_ECHEC_PIN_INVALID: Le code PIN du jeton matériel est incorrect (Compteur verrouillé)',
      mitigationKEDB: 'KEDB-042'
    }
  },
  {
    index: 6,
    id: 'AUD-2026-0006',
    timestampRFC3161: '2026-11-08 14:05:48 UTC [RFC 3161]',
    action: 'EXPORT_AUDIT_WORM_CSV_SIGNE',
    acteur: 'AGT-AN-042',
    roleNiveau: 2,
    details: 'Export CSV WORM signé via Touch ID / FIDO2 par Marcelle Nguema (Sceau Merkle validé)',
    hachagePrecedent: '19bc00192a54ceb84791fe3302bc56aa71a441bbf8a12c93b44e0192a54ceb84',
    hachageActuel: '54ceb84791fe3302bc56aa71a441bb8709caee129033bb7f8a12c93b44e0192a',
    estValide: true,
    biometrie: {
      status: 'SUCCESS',
      actionType: 'EXPORT_AUDIT_WORM',
      actionTitle: 'Download WORM Audit (Export CSV Signé)',
      targetResource: 'Registre WORM (6 blocs scellés Merkle)',
      severity: 'CRITIQUE',
      biometricMethod: 'WebAuthn Platform Authenticator (Windows Hello / Touch ID)',
      authenticatorType: 'PLATFORM',
      userVerification: 'VERIFIED',
      credentialId: 'cred_anif_gab_441_anl',
      challengeHex: 'cc11223344556677889900aabbccddee',
      flags: {
        userPresent: true,
        userVerified: true,
        backupEligible: true,
        backupState: false
      },
      signaturePreview: '304502210091fe3302bc56aa71a441bb...02204fa8710b2c1189bc0019'
    }
  }
];

export const KEDB_ARTICLES: KedbArticle[] = [
  {
    id: 'KEDB-014',
    codeErreur: 'ERR-NET-NKOK-FIBER',
    titre: 'Latence ou perte de paquets sur la liaison optique Libreville - Nkok',
    composant: 'Infrastructure Réseau / BGP Multi-homing',
    symptome: 'Temps de réponse supérieur à 250ms sur les requêtes gRPC/HTTPS vers le cluster souverain.',
    contournement: 'Forcer le routage sur l\'interface vlan904 (boucle Sud Libreville via Owendo).',
    resolutionDefinitive: 'Repasser la commande `ip route replace 10.24.0.0/16 via 10.254.1.2` et réinitialiser la table de routage frontière.'
  },
  {
    id: 'KEDB-029',
    codeErreur: 'ERR-S3-MINIO-403',
    titre: 'Erreur 403 SignatureDoesNotMatch sur stockage compartimenté S3',
    composant: 'Cluster MinIO Souverain / Enclave Chiffrement',
    symptome: 'Refus d\'accès lors du téléchargement des scellés numériques d\'investigation financière.',
    contournement: 'Régénérer le jeton de session STS avec la clé HMAC maître du coffre-fort HashiCorp Vault.',
    resolutionDefinitive: 'Synchroniser l\'horloge locale du terminal client avec le serveur NTP national ANINF stratum-1.'
  },
  {
    id: 'KEDB-042',
    codeErreur: 'ERR-FIDO2-SYNC-LOCKED',
    titre: 'Désynchronisation compteur de signature jeton physique YubiKey',
    composant: 'Module IAM Keycloak / WebAuthn FIDO2',
    symptome: 'Échec de connexion avec message "Security key assertion failed: counter roll-back".',
    contournement: 'Authentification de secours par double clé PGP de la Direction Générale.',
    resolutionDefinitive: 'Réinitialiser le compteur de séquence dans la table Keycloak `credential_fido2` via la console SSI.'
  }
];
