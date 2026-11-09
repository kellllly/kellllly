# ANIF Gabon — Poste de pilotage

Prototype francophone de démonstration réunissant collaboration interne et gestion des services informatiques.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm 10.26.1 workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/anif-secure-desk/` — application web
- `artifacts/api-server/` — API Express partagée, authentification Clerk et routes ITSM
- `.local/conversation-workspace/files/` — fichiers transmis lors de la préparation du projet

## Architecture decisions

- Les exemples et changements ITSM du pilote sont partagés côté serveur dans PostgreSQL; les données locales existantes sont importées sans écrasement et conservées dans le navigateur.
- Les comptes Clerk authentifiés accèdent au même espace fictif. L'API applique les rôles ITSM N1–N5, les périmètres de services, les transitions, l'identité des actions, l'approbation CAB et la confirmation de clôture.
- Les changements d'habilitation N1 et le bootstrap sont sérialisés côté API. Pour remplacer un N1, nommer d'abord le remplaçant, puis retirer l'ancien accès; l'API refuse de retirer le dernier N1 actif. Une révocation manuelle marque le bootstrap comme effectué et ne rétablit pas automatiquement l'accès.
- Aucun chiffrement certifié, mécanisme E2EE, journal inviolable ou hébergement souverain n'est implémenté ni revendiqué.
- Ne saisir aucune donnée personnelle, financière, d'enquête ou classifiée dans la démonstration.
- Les SLA suivent le temps continu, pas un calendrier ouvré contractuel. Cette simplification permet d’illustrer les parcours avant validation des règles d’astreinte et d’horaires avec le SSI.
- Une sauvegarde locale illisible ne doit jamais être remplacée automatiquement par les exemples. Elle reste intacte et n'est pas importée; l'espace ITSM partagé reste consultable.

## Product

Le prototype illustre un tableau de bord institutionnel, une messagerie simulée, un guichet ITSM, un catalogue de services, une base de connaissances, un inventaire fictif et un journal d'activité simulé. Les tickets et conversations fictifs sont partagés entre les comptes authentifiés; préférences d'apparence et brouillons restent locaux ou en mémoire.

Le PDF de référence est traduit en parcours de qualification P1–P4, prise en charge et escalade L1/L2/L3, approbation CAB simulée, résolution documentée et clôture validée alimentant la KEDB. Les messages de support peuvent être reliés à un ticket après relecture manuelle. Le journal propose des filtres et un export CSV. La gouvernance distingue cinq profils de référence et les exigences de production non réalisées.

Voir `docs/specification-coverage.md` pour la correspondance au cahier des charges, les limites techniques et les règles SLA retenues.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Chaque sauvegarde envoie tout l’espace partagé : la limite JSON de l’API est de 5 Mo (`ITSM_JSON_BODY_LIMIT`). Ne pas revenir à la limite Express par défaut (100 Ko), qui bloque les sauvegardes après environ 450 événements de journal.
- CORS est fermé par défaut ; ajouter une origine via `CORS_ALLOWED_ORIGINS` seulement si un client sur un autre domaine en a besoin.
- Après un refus de sauvegarde autre qu’un conflit, l’onglet recharge l’état serveur et reprend l’enregistrement ; si le rechargement échoue, il reste suspendu et propose « Resynchroniser ».
- La synchronisation interroge `GET /api/itsm/version` toutes les 5 s (onglet visible uniquement) et ne télécharge l’espace complet que si la version a changé. Ne pas revenir à un sondage de `GET /api/itsm`, qui transférait tout l’espace à chaque tick.
- Dépassements SLA : `lib/itsm-sla.ts` (mêmes délais que `SLA_POLICIES` du frontend, à garder synchronisés) vérifie les tickets ouverts chaque minute et ajoute au journal un événement `itsm.sla.breached` par ticket et par échéance (acteur `system:sla-monitor`), avec le log `ITSM_SLA_BREACHED`. Une prise en charge ou résolution tardive compte comme dépassement ; les tickets clos ou rejetés sont ignorés. Le navigateur ne peut pas créer d’événement de journal dont le type commence par `itsm.`.
- Salons d’enquête : conversation `kind: "Enquête"` avec `memberIds`, créée par un N1 seulement, forcée en Restreint. `canSeeConversation` (lib/itsm-workspace.ts) la cache aux N3, N4, N5 et aux N2 non invités. À l’enregistrement, l’API réinsère à leur place les salons que le compte ne voit pas ; ne pas supprimer cette étape, sinon chaque sauvegarde d’un N3 serait refusée (« suppression des conversations »). Les identifiants de conversation sont aléatoires (`C-XXXXXXXX`) pour éviter les collisions avec des salons invisibles.
- Canaux temporaires : conversation `kind: "Temporaire"` créée par un N1 seulement, avec `memberIds` (tous rôles sauf N4) et `expiresAt` calculé par le serveur à partir de `durationHours` (1 à 720, 24 par défaut). Un N5 ne voit que les canaux temporaires dont il est membre et qui ne sont pas clos ; il publie par `POST /api/itsm/conversations/:id/messages` (pas par la sauvegarde de l’espace, qui reste en lecture seule pour lui). Après `expiresAt`, le canal refuse tout message (409) et reste lisible par les autres membres.
- Canaux bilatéraux : conversation `kind: "Direct"` créée par un N1, N2 ou N3, `memberIds` = le créateur et exactement un autre compte, classée Confidentiel ; un seul canal par paire. `canSeeConversation` ne la montre qu’aux deux membres (pas même au N1). Le collègue est choisi via `GET /api/itsm/contacts?q=` (N1–N3 seulement) : nom et rôle des autres comptes N1–N3, recherche sur le nom uniquement (jamais sur l’e-mail), liste Clerk mise en cache 60 s.
- `store.profile` n’est pas dans les données partagées : `applySnapshot` garde le profil courant quand la réponse n’en contient pas. Sans cela, chaque enregistrement ramenait le profil de démonstration (N2).
- Services d’appui (N4) : `canSeeConversation` ne leur montre que les conversations `kind: "Annonce"` et `kind: "Administratif"` ; les autres sont réinsérées à l’enregistrement comme pour les autres rôles. Un N4 n’ouvre que des salons administratifs ; seul un N1 ouvre un canal d’annonces et y publie (refus 403 sinon). Au démarrage, `ensureSupportServiceChannelsNow` crée `C-ANN` « Annonces générales » et `C-ADM` « Services d’appui — coordination » s’ils manquent (jamais sur un espace neuf, qui garde le jeu de démonstration du navigateur).
- Hors ligne (`lib/offline.ts`, `lib/store.tsx`) : un enregistrement qui échoue faute de réseau (fetch en échec, 502/504, `navigator.onLine` faux) ne bloque pas les saisies. `offline` passe à vrai, le bandeau `banner-offline` s’affiche et l’état local est copié dans un brouillon de reprise d’identifiant fixe `hors-ligne`. Toutes les 10 s, et à l’événement `online`, l’interface sonde `GET /api/itsm/version` puis renvoie par le circuit normal, qui fusionne les changements après un 409. Si l’onglet est rouvert avec ce brouillon, `hydrate` l’envoie quand la fusion ne présente aucun conflit ; sinon il devient un brouillon de reprise ordinaire. Ne pas traiter 503 comme une coupure : l’API l’utilise pour ses propres refus.
- Pièces jointes simulées (`lib/itsm-attachments.ts` côté API, `src/lib/attachments.ts` côté navigateur : garder les deux listes identiques). Le message porte `attachment: { name, type, size, sha256, warnings, acknowledged? }`, sans contenu. `messageExpiry` passe par `sanitizeAttachment` : un exécutable, un script ou un fichier de plus de 25 Mo est refusé. Un avertissement non confirmé est refusé aussi, et les avertissements sont recalculés par le serveur. La purge des messages éphémères supprime aussi le descriptif.
- Messages envoyés par le navigateur (`clientMessage` dans lib/itsm-workspace.ts) : seuls `body`, `isInstruction` (booléen), `ttlSeconds`, `attachment` et `ticketId` sont conservés. `ticketId` n’est gardé que s’il désigne un ticket lié à la même conversation. Auteur, identifiant et horodatage viennent du serveur. Un avis système (`system: true`) envoyé par un client est ignoré : le serveur écrit lui-même les avis de conversion (« Incident X ouvert en P… ») et de changement d’état. Ne pas réaccepter `system` depuis le client, sinon n’importe quel compte pourrait publier un faux avis officiel.
- Messages éphémères : `ttlSeconds` envoyé par le navigateur, borné à 30 s–30 jours ; `expiresAt` et `expired` sont calculés par le serveur. `purgeExpiredMessagesNow` (toutes les 15 s) vide le texte et garde le message à sa place.
- Escalade SLA : `findSlaEscalations` (lib/itsm-sla.ts), une fois par ticket et par règle (clé `escalationKey` dans le journal). La règle P2 réaffecte le ticket à « Ingénieur senior L2 ».
- Filigrane : `GET /api/itsm/session` renvoie le compte et l’IP (première valeur de X-Forwarded-For) ; c’est une aide à l’attribution, pas un contrôle d’accès.
- Journal chaîné : le serveur scelle chaque événement (`seq`, `prevHash`, `hash` SHA-256 sur le JSON canonique) dans `retainItsmAuditEvents` (`lib/itsm-audit-chain.ts`). Ces champs ne sont jamais acceptés d’un client ni d’un import. Au-delà de 5 000 événements ordinaires, les plus anciens deviennent des souches `pruned: true` qui gardent leur sceau (non envoyées au navigateur, absentes de l’export) : ne pas les supprimer, sinon la chaîne est rompue. Un journal écrit avant le scellement est scellé au démarrage de l’API (`sealStoredAuditJournal`) ou à la sauvegarde suivante ; tant qu’aucun événement n’a de sceau, la vérification répond `unsealed` (pas « rompu »). `GET /api/itsm/audit/integrity` (N1, N3, N5) vérifie la chaîne et journalise l’alerte `itsm_audit_chain_broken`. Ce n’est pas une archive WORM.
- Points de contrôle Merkle (`lib/itsm-audit-merkle.ts`, construction RFC 6962) : feuilles = sceaux `hash` dans l’ordre `seq`, souches purgées comprises. `GET /api/itsm/audit/integrity` ajoute `merkle: { root, size }` (null si la chaîne n’est pas intacte). `GET /api/itsm/audit/proof?event=<id ou seq>&treeSize=<n>` (N1, N3, N5) renvoie la preuve d’inclusion contre l’arbre des n premiers événements ; 409 si la chaîne est rompue. Le navigateur vérifie la preuve avec WebCrypto (`src/lib/audit-merkle.ts`) contre la racine notée par l’auditeur (format `taille:racine`). Ne pas changer l’ordre des feuilles ni le préfixe 0x00/0x01 : les racines déjà notées ne correspondraient plus.
- Flux SIEM (`lib/itsm-audit-siem.ts`) : `GET /api/itsm/audit/siem?after=<seq>&limit=<1..1000>` (N1, N3, N5) renvoie du NDJSON (`application/x-ndjson`), un événement par ligne aux champs ECS (`@timestamp`, `event.action/category/sequence`, `user.id`, `anif.seal`…), du plus ancien au plus récent. En-têtes : `X-ANIF-Next-After` (curseur du prochain appel), `X-ANIF-Journal-Head`, `X-ANIF-Chain-Status`. Les souches purgées sont sautées mais le curseur avance. Seuls les champs listés dans `toSiemRecord` sont exportés : un nouveau champ d’événement doit y être ajouté explicitement.
- Contrôles de sécurité GitHub (`.github/workflows/security.yml`) : `pnpm audit --audit-level moderate` (CVSS ≥ 4,0 bloquant) et CodeQL `security-extended` filtré par `scripts/sast-gate.sh` (sévérité ≥ 4,0 bloquante, rapport SARIF en artefact). zod est en version 4 (catalogue `pnpm-workspace.yaml`, Orval `version: 4`) : zod 3 avait une faille d’épuisement mémoire. Ne pas revenir à zod 3. `@tailwindcss/typography` épingle postcss-selector-parser 6.0.10 vulnérable : une override force ^6.1.5. Les workflows ne fixent pas la version de pnpm : elle vient de `packageManager` (deux versions font échouer `pnpm/action-setup`). Orval est figé à la version exacte 8.46.0 (`lib/api-spec/package.json`) : deux versions différentes produisent un code généré différent, et le contrôle `check:api-codegen` échouerait d’un environnement à l’autre. Les overrides de `pnpm-workspace.yaml` imposent des planchers de sécurité (fast-uri, body-parser, qs, undici, zod) : ils protègent aussi un lockfile ancien, comme celui de Replit, qui garde `artifacts/mockup-sandbox`.
- Limitation de débit (`lib/itsm-rate-limit.ts`, express-rate-limit) : 30 appels par minute et par compte Clerk, partagés entre `/api/itsm/audit/integrity`, `/proof`, `/siem` et `/export` (chacun relit tout le journal) ; au-delà, 429 en français et alerte `itsm_audit_rate_limited`. Les tests qui compilent `routes/itsm.ts` avec esbuild doivent garder `express-rate-limit` dans `external`. Couverture : `pnpm --filter <paquet> run test:coverage` (seuils 90 % lignes, 80 % branches, 85 % fonctions), appelé par la CI.
- Fuzzing (fast-check) : `artifacts/api-server/tests/itsm-workspace.fuzz.test.ts` et `artifacts/anif-secure-desk/tests/fuzz.test.ts`, lancés avec les autres tests. `FUZZ_RUNS` (défaut 150 côté API, 300 côté interface) et `FUZZ_SEED` (graine fixe, 20261109) règlent une campagne plus longue ou reproduisent un contre-exemple. Le test principal exige qu’au moins 15 % des mises à jour aléatoires soient acceptées : sinon les propriétés ne vérifieraient rien. Le filtre d’e-mail de `sensitive-data.ts` est borné (64 + 253 caractères, début de mot) : ne pas revenir à des `+` non bornés (temps quadratique).
- Horodatage RFC 3161 (`lib/itsm-audit-timestamp.ts`, pkijs/asn1js) : `POST /api/itsm/audit/timestamps` (N1, N3) fait signer par `ITSM_TSA_URL` le SHA-256 de `anif-merkle-checkpoint:v1:<taille>:<racine>` ; l’appel à l’autorité a lieu hors verrou, puis l’événement `itsm.audit.timestamped` n’est inscrit que si la racine des N premiers événements est inchangée. `GET /api/itsm/audit/timestamps` (N1, N3, N5) revérifie chaque jeton (signature, empreinte, nonce, EKU timeStamping, chaîne si `ITSM_TSA_TRUSTED_CERTS` ou `ITSM_TSA_TRUSTED_CERTS_FILE` est donné) et signale un journal réécrit ; `GET …/timestamps/:id/token` donne le jeton DER. Ces événements ne sont jamais élagués (`isKeptWholeAuditType`) et le jeton n’est pas envoyé dans la vue du navigateur. Les tests lancent une vraie autorité locale avec `openssl ts` ; les tests qui compilent `routes/itsm.ts` avec esbuild doivent garder `pkijs` et `asn1js` dans `external`.
- Auteurs, demandeurs et acteurs du journal restent stockés sous leur identifiant Clerk (`user_…`). L’interface les remplace à l’affichage via `GET /api/itsm/people?ids=…` (nom seulement, jamais d’e-mail ni de rôle, 100 identifiants max, cache serveur de 5 min). Ne pas stocker les noms à la place des identifiants : « mes messages » et les contrôles de l’API reposent sur l’identifiant. L’export CSV du journal ajoute les colonnes « Nom de l’acteur » et « Nom du compte cible » (vides si l’annuaire Clerk est indisponible : l’export reste possible), et la recherche du journal porte aussi sur ces noms, à l’écran comme dans l’export.
- Archive des habilitations en développement : `ITSM_ROLE_ARCHIVE_MODE = "development-db"` (dans `.replit`). L’archive est écrite dans la même transaction PostgreSQL que le journal. L’ancien mode « external » avec `ITSM_DEV_ROLE_ARCHIVE_URL = "auto"` faisait appeler l’API par sa propre adresse de prévisualisation Replit. Cette adresse est protégée par Replit : l’appel recevait 401 et toute attribution ou attestation échouait avec « L’archive des habilitations est indisponible ». En production, configurer une vraie archive externe (`ITSM_ROLE_ARCHIVE_URL`).
- Le journal des habilitations fait foi (`lib/itsm-role-journal.ts`, appliqué dans `actorFor`). Les métadonnées Clerk ne sont qu’un miroir : le tableau de bord Clerk ou tout script qui détient la clé secrète peut les modifier sans passer par l’application. L’API accorde donc le rôle et les services du dernier événement `itsm.role.changed` ou `itsm.role.attested`.
  - Un compte sans événement au journal est refusé (403) tant qu’un N1 ne l’a pas attesté.
  - Si Clerk et le journal diffèrent, le journal s’applique et l’alerte `ITSM_ROLE_JOURNAL_MISMATCH` est émise une fois.
  - Une révocation au journal l’emporte sur un rôle remis dans Clerk.
  - Exception contre le blocage de tous les N1 : un compte N1 dans Clerk, sans trace au journal, dont l’adresse vérifiée figure dans `ITSM_BOOTSTRAP_ADMIN_EMAILS`, est attesté automatiquement à sa première requête (acteur `system:bootstrap-attestation`, alerte `ITSM_ROLE_BOOTSTRAP_ATTESTED`).
  - La protection du dernier N1 compte les N1 du journal.
  - Les rôles des journaux sont lus par une requête SQL limitée aux événements `itsm.role.*`, mise en cache 5 s ; le cache est vidé après chaque écriture serveur.
- Contrôle des habilitations (Préférences, N1) : `GET /api/itsm/roles/reconciliation` renvoie les mêmes constats que l’alerte `ITSM_ROLE_RECONCILIATION_MISMATCH` (rôle Clerk sans trace au journal, rôle ou services différents). « Examiner » sélectionne le compte, puis le N1 corrige son rôle ou atteste l’état actuel par la route d’attestation existante ; le compte disparaît alors de la liste. L’alerte n’est pas un faux positif : chaque environnement a sa propre base, donc son propre journal ; un rôle posé directement dans Clerk ou par un autre environnement y apparaît toujours.
- Le rôle ITSM de chaque compte est gardé 10 s en mémoire (`itsm-actor-cache.ts`) : sans ce cache, chaque requête interrogeait Clerk, qui répond 429 dès quelques onglets ouverts, et l’API renvoyait 503. Les routes d’habilitation relisent un N1 en direct, et toute modification de rôle faite par l’API vide le cache du compte.
- Toutes les réponses `/api` (sauf le relais `/api/__clerk`) portent une CSP stricte `default-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`, et une route inconnue répond 404 en JSON.
- En local, définir `API_PROXY_TARGET` pour que Vite relaie `/api`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
