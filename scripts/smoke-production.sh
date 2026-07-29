#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://github-scraper-v2.vercel.app}"
SMOKE_REPO="${SMOKE_REPO:-vercel/next.js}"
POLL_SECONDS="${POLL_SECONDS:-15}"
MAX_POLLS="${MAX_POLLS:-60}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

if [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "ADMIN_PASSWORD is required"
  exit 1
fi

echo "[1/5] Login to $BASE_URL"
LOGIN_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" \
  -c "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"password\":\"$ADMIN_PASSWORD\"}")"
[[ "$LOGIN_STATUS" == "200" ]] || { echo "Login failed: HTTP $LOGIN_STATUS"; exit 1; }

echo "[2/5] Verify health endpoint"
HEALTH_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" "$BASE_URL/api/health")"
[[ "$HEALTH_STATUS" == "200" ]] || { echo "Health check failed: HTTP $HEALTH_STATUS"; exit 1; }

echo "[3/5] Queue public repository scrape: $SMOKE_REPO"
START_RESPONSE="$(curl -sS -b "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/scrape" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"repository\",\"target\":\"$SMOKE_REPO\",\"minContributions\":1}")"
SCRAPE_ID="$(printf '%s' "$START_RESPONSE" | sed -n 's/.*"scrapeId":"\([^"]*\)".*/\1/p')"
[[ -n "$SCRAPE_ID" ]] || { echo "Scrape did not queue: $START_RESPONSE"; exit 1; }

echo "[4/5] Wait for scheduled worker: $SCRAPE_ID"
for ((poll = 1; poll <= MAX_POLLS; poll++)); do
  RESPONSE="$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/scrape/$SCRAPE_ID?page=1&pageSize=1")"
  if [[ "$RESPONSE" == *'"status":"completed"'* ]]; then
    echo "Scrape completed after $poll poll(s)"
    break
  fi
  if [[ "$RESPONSE" == *'"status":"failed"'* || "$RESPONSE" == *'"status":"canceled"'* ]]; then
    echo "Scrape ended unsuccessfully: $RESPONSE"
    exit 1
  fi
  if [[ "$poll" == "$MAX_POLLS" ]]; then
    echo "Timed out waiting for scrape completion"
    exit 1
  fi
  sleep "$POLL_SECONDS"
done

echo "[5/5] Confirm contributor endpoint"
curl -sS -b "$COOKIE_JAR" \
  "$BASE_URL/api/scrape/$SCRAPE_ID?page=1&pageSize=1&contactableOnly=true" \
  | rg '"contributors"' >/dev/null

echo "Production smoke passed for $SCRAPE_ID"
