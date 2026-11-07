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

- pnpm workspaces, Node.js 24, TypeScript 5.9
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
- En local, définir `API_PROXY_TARGET` pour que Vite relaie `/api`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
