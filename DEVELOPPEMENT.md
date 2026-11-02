# Développement hors Replit

Ce dépôt est une copie du projet Replit « Plateforme ANIF — Messagerie & ITSM »
(monorepo pnpm : `artifacts/api-server`, `artifacts/anif-secure-desk`, `lib/*`).
Les règles produit et les limites du pilote restent décrites dans `replit.md`
et `docs/`.

## Contenu de la copie

- Copié tel quel : configuration du workspace, `lib/db`, `lib/api-spec`,
  `lib/api-client-react` (hors code généré), `lib/api-zod` (hors code généré),
  serveur API et tests, frontend (pages, composants, logique, tests unitaires),
  scripts, documentation.
- Régénéré plutôt que copié : le code Orval (`lib/*/src/generated`), produit à
  partir de `lib/api-spec/openapi.yaml`. Le résultat a été comparé à la version
  Replit : il est identique.
- Non copié :
  - 47 composants shadcn de `src/components/ui/` qu’aucun écran n’importe.
    Seuls `badge`, `button`, `card`, `dialog`, `input`, `popover`, `toast` et
    `toaster` sont présents. Pour en ajouter un : `pnpm dlx shadcn@latest add <nom>`
    depuis `artifacts/anif-secure-desk`.
  - `artifacts/mockup-sandbox/` (bac à sable de maquettes propre à Replit).
  - `tests/browser/` (scripts de recette navigateur liés à l’environnement Replit).
  - `pnpm-lock.yaml` (trop volumineux pour l’outil de copie) : un nouveau
    verrou est créé au premier `pnpm install`, dans les mêmes plages de versions.
  - `attached_assets/` (PDF du cahier des charges et captures d’écran).

## Prérequis

- Node.js 22.6 ou plus (Replit utilise Node 24), pnpm 10.
- PostgreSQL 16.
- Une instance Clerk de développement à vous. Sur Replit, Clerk est géré par
  le panneau Auth et ses clés ne sont pas exportables : il faut créer votre
  propre application sur dashboard.clerk.com et y reporter les clés.

## Base de données

Créez une base vide, puis appliquez le schéma Drizzle (tables
`anif_itsm_workspace` et `anif_itsm_development_role_archive`, identiques à Replit) :

```bash
createdb anif
```

```bash
DATABASE_URL=postgresql://postgres@localhost:5432/anif pnpm --filter @workspace/db run push
```

La base démarre vide. Au premier chargement par un compte N1, N2 ou N3,
l’application importe les exemples fictifs du pilote. Les données saisies sur
Replit (tickets ajoutés pendant la recette) ne sont pas transférées.

## Lancer les vérifications

```bash
pnpm install
```

```bash
pnpm run typecheck
```

```bash
pnpm --filter @workspace/anif-secure-desk run test
```

```bash
DATABASE_URL=postgresql://postgres@localhost:5432/anif pnpm --filter @workspace/api-server run test
```

Sans `DATABASE_URL`, trois tests API échouent au chargement du module `@workspace/db`
et le test d’intégration PostgreSQL est ignoré.

## Lancer l’application

Copiez `.env.example` en `.env`, renseignez les clés Clerk et
`ITSM_BOOTSTRAP_ADMIN_EMAILS` avec votre adresse vérifiée, puis :

```bash
set -a; . ./.env; set +a; pnpm --filter @workspace/api-server run dev
```

```bash
set -a; . ./.env; set +a; PORT=5173 pnpm --filter @workspace/anif-secure-desk run dev
```

Le frontend appelle `/api/...` sur sa propre origine. Sur Replit, un routeur
place l’API et le frontend sous le même domaine. En local, il faut un proxy
`/api` vers le port 5000 (non configuré dans `vite.config.ts` à ce stade).
