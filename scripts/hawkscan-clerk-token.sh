#!/bin/sh
# Affiche un jeton de session Clerk (1 h) pour le compte de scan HawkScan.
# Instances Clerk de DÉVELOPPEMENT uniquement : l’API backend y crée des sessions de test.
#   CLERK_SECRET_KEY   clé secrète de l’instance de développement
#   HAWK_SCAN_USER_ID  identifiant Clerk d’un compte dédié au scan, rôle N3 (jamais un N1)
#   ANIF_CLERK_PROXY   facultatif : proxy sortant vers api.clerk.com
# Usage : export HAWK_AUTH_TOKEN=$(sh scripts/hawkscan-clerk-token.sh)
set -eu
: "${CLERK_SECRET_KEY:?CLERK_SECRET_KEY manquante}"
: "${HAWK_SCAN_USER_ID:?HAWK_SCAN_USER_ID manquant}"
case "$CLERK_SECRET_KEY" in sk_test_*) ;; *) echo "Refusé : utilisez la clé d’une instance de développement (sk_test_…)." >&2; exit 1 ;; esac
CLERK="https://api.clerk.com/v1"
SID=$(curl -sf --proxy "${ANIF_CLERK_PROXY:-}" -X POST "$CLERK/sessions" \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" -H "Content-Type: application/json" \
  -d "{\"user_id\":\"$HAWK_SCAN_USER_ID\"}" | sed -n 's/.*"id":"\(sess_[A-Za-z0-9]*\)".*/\1/p')
[ -n "$SID" ] || { echo "Session Clerk non créée." >&2; exit 1; }
JWT=$(curl -sf --proxy "${ANIF_CLERK_PROXY:-}" -X POST "$CLERK/sessions/$SID/tokens" \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" -H "Content-Type: application/json" \
  -d '{"expires_in_seconds":3600}' | sed -n 's/.*"jwt":"\([^"]*\)".*/\1/p')
[ -n "$JWT" ] || { echo "Jeton Clerk non obtenu." >&2; exit 1; }
printf '%s\n' "$JWT"
