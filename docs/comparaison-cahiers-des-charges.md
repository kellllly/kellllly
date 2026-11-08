# Comparaison des cahiers des charges ANIF

- **Premier cahier :** le PDF de 21 pages transmis au début du projet. Il n’est plus disponible dans l’environnement de développement. La comparaison s’appuie donc sur ce que le projet en a repris, avec ses références de pages, dans `docs/specification-coverage.md`.
- **Nouveau cahier :** `Cahier_Des_Charges_ANIF_Gabon_1.pdf`, 20 pages, transmis le 8 novembre 2026.

## Ce qui est identique

Les deux documents portent le même titre : *Plateforme unifiée de messagerie chiffrée et de gestion des services SI*. Ils reprennent les mêmes éléments :

- les mêmes cadres réglementaires : GAFI R.29, CEMAC/GABAC, Egmont, souveraineté ANINF, ISO 27001/20000 ;
- la même matrice N1 à N5 ;
- les mêmes délais SLA par priorité :

  | Priorité | Prise en charge | Résolution |
  | --- | --- | --- |
  | P1 | 15 min | 2 h |
  | P2 | 30 min | 4 h |
  | P3 | 2 h | 8 h |
  | P4 | 4 h | 48 h |

- les mêmes cibles de disponibilité : 99,99 %, RTO < 15 min, RPO = 0 ;
- la même pile technique : Tauri/React, Go/Rust, NATS, PostgreSQL, MinIO, Keycloak, Kubernetes ;
- le même chronogramme sur dix mois.

## Ce que le nouveau cahier précise et que le projet ne faisait pas

| Exigence (nouveau cahier) | Avant | Maintenant |
| --- | --- | --- |
| **N3 (SSI) : « interdiction stricte d’accès aux salons d’enquête »** ; seul le N1 crée les canaux d’investigation ; le N2 y accède sur invitation formelle | Un N3 voyait toutes les conversations | Les salons « Enquête » sont créés par un N1, qui choisit les N2 invités. L’API ne les montre jamais aux N3, N4 et N5. |
| **Escalade hiérarchique automatique** : Responsable SI à l’approche du délai, DSI/RSSI/DG pour un P1, ingénieur senior L2 après 45 min pour un P2, coordinateur L1 après 4 h pour un P3, relance du demandeur après 3 jours pour un P4 | Escalade manuelle uniquement | Le serveur applique chaque règle une seule fois : notification, inscription au journal scellé, réaffectation des P2 et relance des P4 dans l’historique du ticket. |
| **Messages éphémères de 30 s à 30 jours** | Absents | L’émetteur choisit la durée. Le serveur efface le texte à l’échéance et journalise l’effacement. |
| **Filigrane dynamique** : matricule, IP, horodatage à la seconde | Absent | Filigrane permanent sur toute l’application (nom, compte, IP, heure). |
| **Filtre d’anonymisation bloquant les données nominatives** à la conversion d’un message | La relecture manuelle était seule exigée | Blocage des e-mails, IBAN, cartes bancaires, téléphones et mentions d’identité, en plus de la relecture. |
| **Capture de l’environnement d’exécution** (version, poste, mémoire, latence) | Absente | Jointe automatiquement au ticket converti. |
| **Bot SI** : arbre de diagnostic, tests d’intégrité préliminaires, fiches en libre-service | Absent | « Assistant SI » dans le canal support : arbre fixe, tests réels de liaison et de session, fiches KEDB proposées. |
| **Fil de discussion privatif alimenté par l’état du ticket** | Seule la création du ticket était annoncée dans le fil | Chaque changement d’état est publié dans la discussion liée. |
| **Canaux d’échanges ad hoc limités dans le temps** pour les auditeurs (N5) et experts externes, avec bannière d’avertissement | Le N5 n’avait aucun accès à la messagerie | Un N1 ouvre un « canal temporaire » (1 h à 30 jours) et choisit les membres. Le N5 ne voit que ses canaux ouverts et peut y écrire ; une bannière prévient chaque membre ; le canal passe en lecture seule à l’échéance. |
| **Canaux bilatéraux** entre deux agents, et **repère visuel** (cadenas doré, badge d’accréditation) sur les salons protégés | Pas d’échange direct à deux ; aucun repère visuel sur les salons restreints | Un N1, N2 ou N3 ouvre un « échange bilatéral » avec un collègue N1 à N3, cherché par son nom. Seuls les deux agents le voient, Direction comprise. Les salons d’enquête, canaux bilatéraux et canaux temporaires portent un cadenas doré et un badge d’accès. Le badge indique qui peut entrer : le pilote ne chiffre pas de bout en bout. |
| **N4 (services d’appui) : « salons collaboratifs administratifs et annonces générales », aucun accès aux canaux d’investigation** | Un N4 n’avait aucun accès à la messagerie | Un N4 voit uniquement le canal « Annonces générales » et les salons administratifs. Il peut écrire dans ces salons et en ouvrir de nouveaux. Seule la Direction (N1) publie des annonces ou ouvre un canal d’annonces. Les deux canaux sont créés au démarrage de l’API. |
| **Journalisation et scellement** (arbres de Merkle, RFC 3161, WORM, SIEM) | Journal sans protection d’intégrité | Chaîne d’empreintes SHA-256 vérifiable (déjà livrée avant ce cahier). Le WORM, l’horodatage qualifié et le SIEM restent à réaliser. |
| **Dépassements SLA tracés** | Visibles seulement à l’écran | Journalisés par le serveur (déjà livré). |

## Ce qui reste hors de portée de ce pilote web

Ces exigences supposent une infrastructure, des clients natifs ou des procédures contractuelles que le prototype ne peut pas fournir. Le projet ne les simule pas.

- **Chiffrement et clés :** chiffrement de bout en bout (X3DH, Double Ratchet, MLS), protection matérielle des clés (Secure Enclave, StrongBox, TPM 2.0), recherche locale chiffrée SQLCipher.
- **Fichiers :** transfert de pièces jointes, purge EXIF et chiffrement AES-256 avant envoi, prévisualisation isolée, blocage des captures d’écran.
- **Authentification :** fédération SAML 2.0 et OIDC avec Keycloak, FIDO2/WebAuthn ou TOTP, filtrage par sous-réseau et VLAN. Le pilote utilise Clerk.
- **Réseau et disponibilité :** mode hors ligne (« Offline-First »), gRPC/HTTP3, architecture multi-sites Nkok–Libreville, sauvegardes 3-2-1-1-0.
- **Engagements de performance :** RTO/RPO, 99,99 %, latence au 99e centile.
- **Qualité et sécurité de la chaîne :** couverture de tests de 90 % et tests de mutation, SAST/SCA bloquants (seuil CVSS 4,0), fuzzing.
- **Homologation et déploiement :** homologation ANINF, audit en boîte blanche, Red Team, livrables DAT/DAS, PCA/PRA, formation.

Le filigrane aide à attribuer une photo d’écran sans pouvoir l’empêcher. Le filtre de données nominatives est indicatif. L’effacement des messages éphémères a lieu sur le serveur, pas sur les terminaux.
