# Périmètre du démonstrateur ANIF

Référence : **Cahier des charges fonctionnel et technique — Plateforme unifiée de
messagerie chiffrée et de gestion des services SI**, PDF transmis par l’utilisateur,
21 pages.

Ce document distingue les parcours illustrés dans le navigateur des engagements
contractuels et des protections de production. Le PDF est une spécification
fournie, pas une attestation juridique, réglementaire ou technique.

## Parcours couverts par l’enrichissement

| Référence du PDF | Traduction dans le démonstrateur |
| --- | --- |
| Matrice des habilitations, p. 3–5 | Les rôles N1–N5 et leurs périmètres de services sont attribués par un N1 dans Préférences, enregistrés dans Clerk et appliqués par l’API (lecture, écriture, export, CAB, résolution). |
| Gestion des incidents, p. 8–10 | Qualification par type, impact et urgence; priorités P1–P4; support L1/L2/L3; prise en charge, escalade et résolution documentée contrôlées par l’API. |
| Niveaux de service, p. 9–10 | Deux délais distincts de prise en charge et de résolution, calculés à partir de l’ouverture initiale. Le serveur vérifie les échéances chaque minute et inscrit au journal chaque dépassement une seule fois (échéance, priorité, niveau, assignation), avec l’alerte d’exploitation `itsm_sla_breached`. L’escalade reste une action manuelle. |
| Passerelle messagerie–ticketing, p. 8 | Conversion d’un message de support après relecture et confirmation manuelle, lien entre le ticket et son fil. Aucun filtre d’anonymisation certifié. |
| Clôture et capitalisation, p. 8 | Cause racine et solution avant résolution; validation explicite simulée du demandeur; fiche KEDB liée au ticket sans doublon. |
| Journalisation, p. 3 | Historique partagé en ajout seul côté serveur, filtrable et exportable en CSV. Chaque événement est scellé par une empreinte SHA-256 chaînée à la précédente (séquence, empreinte précédente, empreinte), vérifiable dans le journal et reprise dans l’export. Cela détecte une modification faite hors de l’application, mais ne vaut ni archive WORM ni horodatage qualifié : un accès en écriture à toute la base permet de recalculer la chaîne, d’où l’intérêt de noter le dernier sceau ailleurs. |
| Continuité, architecture et recette, p. 10–18 | Référentiel de gouvernance séparant les objectifs futurs des comportements effectivement présents. |

| Messagerie (nouveau cahier, 20 p.) | Salons d’enquête réservés aux N1 et aux N2 invités (N3, N4 et N5 exclus par l’API), messages éphémères de 30 s à 30 jours effacés par le serveur, filigrane dynamique (compte, IP, heure), assistant SI de diagnostic dans le canal support, canaux temporaires ouverts par un N1 aux auditeurs N5 et experts externes (durée de 1 h à 30 jours, bandeau d’avertissement, lecture seule après clôture), canaux bilatéraux entre deux agents N1 à N3 (invisibles de tout autre compte), cadenas doré et badge d’accès sur les salons protégés, annonces générales (publiées par N1) et salons administratifs, seuls espaces ouverts aux services d’appui N4. Voir `docs/comparaison-cahiers-des-charges.md`. |
| Passerelle messagerie–ticketing (nouveau cahier) | Détection bloquante des données nominatives et financières, environnement d’exécution joint au ticket, changements d’état publiés dans la discussion liée, escalade automatique selon le tableau SLA. |

## Cibles SLA reprises du cahier

| Priorité | Prise en compte | Résolution |
| --- | --- | --- |
| P1 — Critique | moins de 15 min | moins de 2 h |
| P2 — Majeure | moins de 30 min | moins de 4 h |
| P3 — Normale | moins de 2 h | moins de 8 h |
| P4 — Mineure / Demande | moins de 4 h | moins de 48 h |

Le PDF exige un calcul impact × urgence sans en définir les neuf cases. Le
démonstrateur utilise la matrice explicite suivante :

| Impact \ Urgence | Forte | Moyenne | Faible |
| --- | --- | --- | --- |
| Fort | P1 | P2 | P3 |
| Moyen | P2 | P3 | P3 |
| Faible | P3 | P3 | P4 |

**Choix de démonstration :** les compteurs suivent le temps continu et signalent
un risque à 80 % du délai consommé. Ils ne modélisent ni jours fériés, ni horaires
ouvrés, ni astreintes, ni suspension contractuelle. Ces règles doivent être validées
avec le SSI avant toute implémentation contractuelle. Changer la priorité ne remet
pas le compteur à zéro.

## Exigences non réalisées

- Les rôles N1–N5, leurs périmètres de service et la relève N1 sont appliqués
  par l’API du pilote; cela ne constitue pas une homologation. L’authentification
  fédérée SAML/OIDC avec FIDO2/WebAuthn n’est pas configurée. L’espace partagé
  utilise Clerk;
  l’API vérifie l’authentification, les transitions, la qualification, le CAB,
  la confirmation du demandeur et les identités/horodatages des actions.
- Chiffrement de bout en bout, gestion et révocation des clés, Double Ratchet,
  MLS, SQLCipher et protection matérielle des secrets.
- Transport et stockage de fichiers, sanitarisation EXIF, analyse antivirus du
  contenu et effacement cryptographique sur des terminaux distants. Le pilote ne
  transmet qu’un descriptif des pièces jointes (nom, type, taille, SHA-256) et
  contrôle leur format avant l’envoi.
- Preuves d’audit WORM, SIEM, horodatage RFC 3161 et ancrage externe du sceau. Le pilote fournit
  seulement une chaîne d’empreintes SHA-256 vérifiable (voir Journalisation).
- Réplication, supervision, basculement Nkok/Libreville et sauvegardes 3-2-1-1-0.
- Garantie de disponibilité de 99,99 %, RTO < 15 min, RPO = 0 et performances
  annoncées dans le cahier. Ces valeurs restent des cibles à démontrer.
- Garanties de disponibilité et de restauration. Le mode hors ligne du pilote
  est limité au navigateur : pendant une coupure, les saisies restent dans ce
  navigateur (stockage local non chiffré) et sont envoyées au retour du réseau ;
  il n’y a ni base locale chiffrée ni consultation hors ligne d’un historique
  qui n’a pas encore été chargé.
- Homologation, conformité ISO/GAFI/Egmont, audits indépendants, campagne de
  qualification, clients natifs et déploiement souverain.

## Précisions techniques à valider avant production

- Le typage TypeScript et Tauri n’éliminent pas à eux seuls les failles XSS.
- Aucun filigrane ni blocage de raccourcis ne peut empêcher une photographie
  externe de l’écran ou garantir l’absence de capture.
- La confidentialité du contenu E2EE ne garantit pas automatiquement la
  confidentialité de toutes les métadonnées.
- La compatibilité des primitives, bibliothèques, clients, contraintes d’archivage
  et procédures de récupération doit être conçue par des spécialistes.
- Les références et règles réglementaires du document doivent être vérifiées
  auprès des autorités et conseils compétents.

## Vérifications ciblées

Les tests de règles métier et de stockage côté navigateur se lancent avec :

```sh
pnpm --filter @workspace/anif-secure-desk run test
```

Ils vérifient les neuf combinaisons de priorité, les durées SLA du cahier, les
seuils des compteurs, le maintien de la date d’ouverture, le fuseau de Libreville
et la neutralisation des formules dans les cellules CSV.

Les tests du serveur et des autorisations de flux se lancent avec :

```sh
pnpm --filter @workspace/api-server run test
```

La recette manuelle de deux comptes authentifiés dans deux navigateurs distincts
reste nécessaire pour valider l’affichage en temps réel avec l’API et Clerk.
