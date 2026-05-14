#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "ADMIN_PASSWORD is required"
  echo "Example: ADMIN_PASSWORD='your-password' pnpm smoke:local"
  exit 1
fi

echo "[1/6] Login"
LOGIN_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" \
  -c "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}")"
if [[ "$LOGIN_STATUS" != "200" ]]; then
  echo "Login failed with status $LOGIN_STATUS"
  exit 1
fi

echo "[2/6] Health"
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/health" | rg '"status":"ok"' >/dev/null

echo "[3/6] Scrape list"
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/scrapes" | rg '"active"|\"failed\"|\"completed\"' >/dev/null

echo "[4/6] Jobs list"
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/scrape-jobs" | rg '"jobs"' >/dev/null

echo "[5/6] Watched repos list"
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/watched-repos" >/dev/null

echo "[6/6] Audit events"
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/audit-events?limit=5" | rg '"events"' >/dev/null

echo "Smoke check passed against $BASE_URL"
