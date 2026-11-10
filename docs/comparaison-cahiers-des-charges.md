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
| **Architecture « Offline-First »** : saisie de messages et de tickets pendant une coupure, file locale persistante, synchronisation ordonnée au retour du réseau sans collision | Une coupure bloquait tout enregistrement | Pendant une coupure, l’interface accepte les saisies, affiche un bandeau « Hors ligne » et garde une copie dans le navigateur. Au retour du réseau, elle envoie tout dans l’ordre et fusionne avec les changements faits entre-temps. Si la page a été fermée, l’envoi a lieu à la réouverture ; en cas de conflit, la reprise est proposée comme pour un enregistrement refusé. Le stockage local n’est pas chiffré. |
| **Panneau d’avertissement pédagogique** avant l’envoi d’une pièce jointe suspecte ou d’un format inhabituel | Pas de pièces jointes | Pièces jointes simulées : seuls le nom, le type, la taille et l’empreinte SHA-256 calculée dans le navigateur sont transmis, jamais le contenu. Les exécutables et scripts, y compris derrière une double extension, sont refusés ; les fichiers de plus de 25 Mo aussi. Avant l’envoi d’un document à macros, d’une archive, d’un format actif ou inhabituel, d’un fichier dont le type ne correspond pas à l’extension, ou d’une photo (métadonnées EXIF non purgées), un panneau explique le risque et demande une confirmation, contrôlée aussi par l’API. |
| **Journalisation et scellement** (arbres de Merkle, RFC 3161, WORM, SIEM) | Journal sans protection d’intégrité | Chaîne d’empreintes SHA-256 vérifiable (déjà livrée avant ce cahier), plus un arbre de Merkle (RFC 6962) sur les sceaux. Chaque vérification affiche un point de contrôle (taille et racine) à noter hors du pilote. Pour un événement donné, le serveur fournit sa preuve d’inclusion dans ce point de contrôle, et le navigateur la recalcule : un événement réécrit ou inséré après coup ne correspond plus à la racine notée. Un flux SIEM (`GET /api/itsm/audit/siem`, NDJSON aux champs ECS, curseur par numéro de séquence, état de la chaîne en en-tête) permet à un collecteur de récupérer le journal ; aucun SIEM n’est raccordé dans le pilote. Horodatage RFC 3161 : un N1 ou un N3 fait signer par une autorité d’horodatage externe (`ITSM_TSA_URL`) l’empreinte du point de contrôle (`anif-merkle-checkpoint:v1:<taille>:<racine>`) ; le jeton est inscrit au journal scellé, revérifié à chaque affichage (signature, empreinte, nonce, certificat d’horodatage, chaîne vers une racine configurée) et téléchargeable pour `openssl ts -verify`. Si les événements horodatés sont réécrits, même avec une chaîne recalculée, la racine ne correspond plus et l’écran le signale. La valeur « qualifiée » dépend de l’autorité choisie (eIDAS). Le WORM reste à réaliser. |
| **SAST/SCA bloquants (seuil CVSS 4,0)** | Aucune analyse de sécurité dans la CI | Workflow « Sécurité » à chaque push, chaque pull request et chaque lundi : `pnpm audit --audit-level moderate` (toute faille de dépendance de CVSS 4,0 ou plus bloque) et CodeQL `security-extended`, bloquant dès qu’un résultat atteint une sévérité de 4,0. Deux failles de dépendances corrigées à cette occasion : zod 3 → 4 (épuisement mémoire, CVSS 7,5) et postcss-selector-parser 6.0.10 → 6.1.x (CVSS 5,9). La première analyse CodeQL a aussi relevé l’absence de limitation de débit sur les routes du journal (désormais 30 appels par minute et par compte) et une expression régulière à coût polynomial dans le client d’API (remplacée). |
| **Couverture de tests de 90 %** | Non mesurée | La CI échoue sous 90 % de lignes, 80 % de branches et 85 % de fonctions couvertes. Mesure actuelle : API 97 % des lignes, interface 96 %. Le périmètre mesuré est celui des modules importés par les tests : la logique métier (`src/lib`, routes du journal) ; les composants React et `routes/itsm.ts`, exercé à travers une compilation esbuild, ne sont pas comptés. |
| **Fuzzing** | Absent | Tests de propriétés (fast-check) dans les suites de l’API et de l’interface, donc dans la CI : un espace de travail quelconque envoyé par le navigateur, sous chacun des rôles N1 à N5, est refusé proprement ou respecte les garanties du serveur (chaîne du journal intacte, aucun événement d’habilitation forgé, salons invisibles inchangés, messages signés par leur auteur) ; pièces jointes, preuves Merkle, flux SIEM, filtre de données nominatives, point de contrôle collé et brouillons locaux corrompus. Défaut trouvé et corrigé : le filtre d’adresses e-mail prenait jusqu’à 59 s sur un long texte sans « @ » (temps quadratique) ; il est désormais borné. Campagne longue : 3 000 essais par propriété avec trois graines, sans défaut. |
| **Authentification forte** (FIDO2/WebAuthn ou TOTP) pour les actions sensibles | Une session ouverte suffisait | Attribuer, retirer ou attester un rôle exige une vérification d’identité de moins de 10 minutes (réauthentification Clerk) : la fenêtre de Clerk s’ouvre, puis l’action reprend. Avec `ITSM_REQUIRE_SECOND_FACTOR=true`, la session doit en plus avoir été ouverte avec un second facteur (application TOTP, clé de sécurité ou passkey) et les deux facteurs doivent être récents ; sinon l’action est refusée avec la consigne d’en activer un. Option désactivée par défaut, pour ne pas bloquer des comptes N1 sans second facteur ; les facteurs disponibles se règlent dans le tableau de bord Clerk. |
| **Dépassements SLA tracés** | Visibles seulement à l’écran | Journalisés par le serveur (déjà livré). |

## Ce qui reste hors de portée de ce pilote web

Ces exigences supposent une infrastructure, des clients natifs ou des procédures contractuelles que le prototype ne peut pas fournir. Le projet ne les simule pas.

- **Chiffrement et clés :** chiffrement de bout en bout (X3DH, Double Ratchet, MLS), protection matérielle des clés (Secure Enclave, StrongBox, TPM 2.0), recherche locale chiffrée SQLCipher.
- **Fichiers :** transfert et stockage du contenu des pièces jointes, analyse antivirus, purge EXIF et chiffrement AES-256 avant envoi, prévisualisation isolée, blocage des captures d’écran.
- **Authentification :** fédération SAML 2.0 et OIDC avec Keycloak, filtrage par sous-réseau et VLAN. Le pilote utilise Clerk ; le second facteur (TOTP, passkey) dépend de sa configuration.
- **Réseau et disponibilité :** stockage local chiffré et consultation hors ligne d’un historique non chargé, gRPC/HTTP3, architecture multi-sites Nkok–Libreville, sauvegardes 3-2-1-1-0.
- **Engagements de performance :** RTO/RPO, 99,99 %, latence au 99e centile.
- **Qualité et sécurité de la chaîne :** tests de mutation, couverture des composants d’interface. (Le SAST/SCA bloquant et le seuil de couverture de la logique métier sont en place, voir plus haut.)
- **Homologation et déploiement :** homologation ANINF, audit en boîte blanche, Red Team, livrables DAT/DAS, PCA/PRA, formation.

Le filigrane aide à attribuer une photo d’écran sans pouvoir l’empêcher. Le filtre de données nominatives est indicatif. L’effacement des messages éphémères a lieu sur le serveur, pas sur les terminaux.
