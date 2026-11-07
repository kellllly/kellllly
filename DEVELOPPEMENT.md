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
`ITSM_BOOTSTRAP_ADMIN_EMAILS` avec votre adresse vérifiée, puis lancez l’API
et le frontend dans deux terminaux :

```bash
set -a; . ./.env; set +a; pnpm --filter @workspace/api-server run dev
```

```bash
set -a; . ./.env; set +a; PORT=5173 pnpm --filter @workspace/anif-secure-desk run dev
```

Ouvrez http://localhost:5173. Avec `API_PROXY_TARGET=http://localhost:5000`
(déjà dans `.env.example`), Vite relaie `/api` vers l’API : navigateur et API
partagent la même origine, comme sur Replit. Sans ce paramètre, rien ne change
sur Replit.

Comportements attendus sans configuration complète :

- Sans `VITE_CLERK_PUBLISHABLE_KEY` en local, la page affiche « Authentification
  non configurée » au lieu d’une page blanche.
- Sans `CLERK_SECRET_KEY`, `/api/healthz` répond toujours `200` et les routes
  authentifiées répondent `503` avec un message explicite.

## Sécurité HTTP de l’API

- CORS fermé par défaut : seules les origines listées dans
  `CORS_ALLOWED_ORIGINS` (séparées par des virgules) et les domaines de
  `REPLIT_DOMAINS` reçoivent les en-têtes cross-origin. L’application elle-même
  n’en a pas besoin, car elle est servie sur la même origine que l’API.
- En-têtes défensifs sur chaque réponse (`nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`).
- Les erreurs inattendues renvoient un JSON générique ; la pile d’exécution
  reste dans les journaux du serveur.
- Corps JSON limité à 5 Mo, ce qui couvre un espace avec 5 000 événements de journal
  (environ 1 Mo). L’ancienne limite par défaut (100 Ko) bloquait les
  sauvegardes après environ 450 événements.

## Intégration continue

`.github/workflows/ci.yml` exécute, à chaque envoi, l’installation figée, le
typecheck complet (y compris la vérification du code généré), le schéma Drizzle
sur un PostgreSQL 16, les tests frontend et API, puis les builds.

## Scan de sécurité HawkScan (StackHawk)

`stackhawk.yml` scanne l’API locale (`http://localhost:5000/api`) à partir de
`lib/api-spec/openapi.yaml`, en tant que compte Clerk de scan dédié.

1. Installez le CLI `hawk` (v6 ou plus) et définissez `HAWK_API_KEY`.
2. Créez dans votre instance Clerk **de développement** un compte réservé au scan,
   avec le rôle N3 (`publicMetadata.itsmRole = "N3"`), jamais un N1.
3. Lancez l’API (voir plus haut), puis :

```bash
export HAWK_SCAN_USER_ID=user_...   # identifiant du compte de scan
```

```bash
export HAWK_AUTH_TOKEN=$(sh scripts/hawkscan-clerk-token.sh)
```

```bash
API_KEY=$HAWK_API_KEY hawk scan stackhawk.yml
```

Le script refuse une clé autre que `sk_test_…` : l’API backend de Clerk ne crée
des sessions de test que sur une instance de développement. Le jeton dure 1 h.
Le scan écrit dans l’espace ITSM de la base locale : ne le lancez jamais contre
une base qui contient des données à conserver.
