#!/usr/bin/env bash
# Installation unique : pnpm, dépendances, schéma de base de données.
set -euo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/anif}"

if ! command -v pnpm >/dev/null 2>&1; then
  npm install -g pnpm@10.28.0
fi

pnpm install --frozen-lockfile

echo "Attente de PostgreSQL…"
for i in $(seq 1 30); do
  if pnpm --filter @workspace/db run push; then
    echo "Schéma de base de données appliqué."
    exit 0
  fi
  sleep 2
done
echo "PostgreSQL ne répond pas : relancez « bash .devcontainer/setup.sh »." >&2
exit 1
