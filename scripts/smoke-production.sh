#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://github-scraper-v2.vercel.app}"
SMOKE_REPO="${SMOKE_REPO:-vercel/next.js}"
POLL_SECONDS="${POLL_SECONDS:-15}"
MAX_POLLS="${MAX_POLLS:-60}"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

if [[ -z "${ADMIN_EMAIL:-}" || -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "ADMIN_EMAIL and ADMIN_PASSWORD are required"
  exit 1
fi

json_field() {
  local field="$1"
  node -e '
    const fs = require("node:fs")
    const value = JSON.parse(fs.readFileSync(0, "utf8"))[process.argv[1]]
    if (typeof value !== "string") process.exit(1)
    process.stdout.write(value)
  ' "$field"
}

echo "[1/5] Login to $BASE_URL"
LOGIN_STATUS="$(
  ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" node -e '
    process.stdout.write(JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }))
  ' | curl -sS -o /dev/null -w "%{http_code}" \
  -c "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  --data-binary @-
)"
[[ "$LOGIN_STATUS" == "200" ]] || { echo "Login failed: HTTP $LOGIN_STATUS"; exit 1; }

echo "[2/5] Verify health endpoint"
HEALTH_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" -b "$COOKIE_JAR" "$BASE_URL/api/health")"
[[ "$HEALTH_STATUS" == "200" ]] || { echo "Health check failed: HTTP $HEALTH_STATUS"; exit 1; }

echo "[3/5] Queue public repository scrape: $SMOKE_REPO"
START_RESPONSE="$(curl -sS -b "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/scrape" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"repository\",\"target\":\"$SMOKE_REPO\",\"minContributions\":1}")"
SCRAPE_ID="$(printf '%s' "$START_RESPONSE" | json_field scrapeId || true)"
[[ -n "$SCRAPE_ID" ]] || { echo "Scrape did not queue: $START_RESPONSE"; exit 1; }

echo "[4/5] Wait for scheduled worker: $SCRAPE_ID"
for ((poll = 1; poll <= MAX_POLLS; poll++)); do
  RESPONSE="$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/scrape/$SCRAPE_ID?page=1&pageSize=1")"
  SCRAPE_STATUS="$(printf '%s' "$RESPONSE" | json_field status || true)"
  if [[ "$SCRAPE_STATUS" == "completed" ]]; then
    echo "Scrape completed after $poll poll(s)"
    break
  fi
  if [[ "$SCRAPE_STATUS" == "failed" || "$SCRAPE_STATUS" == "canceled" ]]; then
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
  | node -e '
      const fs = require("node:fs")
      const response = JSON.parse(fs.readFileSync(0, "utf8"))
      if (!Array.isArray(response.contributors)) process.exit(1)
    '

echo "Production smoke passed for $SCRAPE_ID"
