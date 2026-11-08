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
- Messages éphémères : `ttlSeconds` envoyé par le navigateur, borné à 30 s–30 jours ; `expiresAt` et `expired` sont calculés par le serveur. `purgeExpiredMessagesNow` (toutes les 15 s) vide le texte et garde le message à sa place.
- Escalade SLA : `findSlaEscalations` (lib/itsm-sla.ts), une fois par ticket et par règle (clé `escalationKey` dans le journal). La règle P2 réaffecte le ticket à « Ingénieur senior L2 ».
- Filigrane : `GET /api/itsm/session` renvoie le compte et l’IP (première valeur de X-Forwarded-For) ; c’est une aide à l’attribution, pas un contrôle d’accès.
- Journal chaîné : le serveur scelle chaque événement (`seq`, `prevHash`, `hash` SHA-256 sur le JSON canonique) dans `retainItsmAuditEvents` (`lib/itsm-audit-chain.ts`). Ces champs ne sont jamais acceptés d’un client ni d’un import. Au-delà de 5 000 événements ordinaires, les plus anciens deviennent des souches `pruned: true` qui gardent leur sceau (non envoyées au navigateur, absentes de l’export) : ne pas les supprimer, sinon la chaîne est rompue. Un journal écrit avant le scellement est scellé au démarrage de l’API (`sealStoredAuditJournal`) ou à la sauvegarde suivante ; tant qu’aucun événement n’a de sceau, la vérification répond `unsealed` (pas « rompu »). `GET /api/itsm/audit/integrity` (N1, N3, N5) vérifie la chaîne et journalise l’alerte `itsm_audit_chain_broken`. Ce n’est pas une archive WORM.
- Auteurs, demandeurs et acteurs du journal restent stockés sous leur identifiant Clerk (`user_…`). L’interface les remplace à l’affichage via `GET /api/itsm/people?ids=…` (nom seulement, jamais d’e-mail ni de rôle, 100 identifiants max, cache serveur de 5 min). Ne pas stocker les noms à la place des identifiants : « mes messages » et les contrôles de l’API reposent sur l’identifiant. L’export CSV du journal ajoute les colonnes « Nom de l’acteur » et « Nom du compte cible » (vides si l’annuaire Clerk est indisponible : l’export reste possible), et la recherche du journal porte aussi sur ces noms, à l’écran comme dans l’export.
- Le rôle ITSM de chaque compte est gardé 10 s en mémoire (`itsm-actor-cache.ts`) : sans ce cache, chaque requête interrogeait Clerk, qui répond 429 dès quelques onglets ouverts, et l’API renvoyait 503. Les routes d’habilitation relisent un N1 en direct, et toute modification de rôle faite par l’API vide le cache du compte.
- Toutes les réponses `/api` (sauf le relais `/api/__clerk`) portent une CSP stricte `default-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`, et une route inconnue répond 404 en JSON.
- En local, définir `API_PROXY_TARGET` pour que Vite relaie `/api`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
