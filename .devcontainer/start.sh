#!/usr/bin/env bash
# Lance l'API (port 5000, en arrière-plan) puis le site (port 5173).
set -uo pipefail
cd "$(dirname "$0")/.."

# Un fichier .env à la racine est pris en compte s'il existe (facultatif).
if [ -f .env ]; then set -a; . ./.env; set +a; fi

# Dans le conteneur, la base est toujours celle du service « db ».
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/anif"
export CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY:-${VITE_CLERK_PUBLISHABLE_KEY:-}}"
export VITE_CLERK_PUBLISHABLE_KEY="${VITE_CLERK_PUBLISHABLE_KEY:-$CLERK_PUBLISHABLE_KEY}"
export NODE_ENV="${NODE_ENV:-development}" BASE_PATH="${BASE_PATH:-/}"
export API_PROXY_TARGET="${API_PROXY_TARGET:-http://localhost:5000}"

if [ -z "${CLERK_SECRET_KEY:-}" ] || [ -z "$VITE_CLERK_PUBLISHABLE_KEY" ]; then
  echo "⚠  Clés Clerk absentes : l'application affichera « Authentification non configurée »."
  echo "   Ajoutez CLERK_SECRET_KEY et VITE_CLERK_PUBLISHABLE_KEY dans"
  echo "   GitHub → Settings → Codespaces → Secrets, puis redémarrez le Codespace."
fi

mkdir -p .logs

# Crée ou met à jour les tables à chaque lancement (sans effet si elles existent déjà).
echo "Vérification du schéma de la base…"
schema_ok=false
for i in $(seq 1 30); do
  if pnpm --filter @workspace/db run push > .logs/schema.log 2>&1; then schema_ok=true; break; fi
  sleep 2
done
if [ "$schema_ok" = true ]; then
  echo "Schéma de la base à jour."
else
  echo "⚠  Impossible de créer les tables : voir .logs/schema.log" >&2
fi

if curl -sf http://localhost:5000/api/healthz >/dev/null 2>&1; then
  echo "API déjà lancée."
else
  echo "Démarrage de l'API… (journal : .logs/api.log)"
  PORT=5000 nohup pnpm --filter @workspace/api-server run dev > .logs/api.log 2>&1 &
  for i in $(seq 1 60); do
    curl -sf http://localhost:5000/api/healthz >/dev/null 2>&1 && break
    sleep 1
  done
fi

if curl -sf http://localhost:5173/ >/dev/null 2>&1; then
  echo "Site déjà lancé : onglet « Ports », ligne 5173."
  exit 0
fi

echo "Démarrage du site : il s'ouvrira dans un nouvel onglet (sinon onglet « Ports », ligne 5173)."
PORT=5173 exec pnpm --filter @workspace/anif-secure-desk run dev
