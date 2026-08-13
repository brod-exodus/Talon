#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASE_URL="${BASE_URL:-https://github-scraper-v2.vercel.app}"
BASE_URL="${BASE_URL%/}"
SMOKE_REPO="${SMOKE_REPO:-octocat/Hello-World}"
SMOKE_CANCEL_REPO="${SMOKE_CANCEL_REPO:-$SMOKE_REPO}"
POLL_SECONDS="${POLL_SECONDS:-5}"
MAX_POLLS="${MAX_POLLS:-60}"
CANCEL_SETTLE_SECONDS="${CANCEL_SETTLE_SECONDS:-2}"
KEEP_SMOKE_ARTIFACTS="${KEEP_SMOKE_ARTIFACTS:-false}"
TEMP_DIR="$(mktemp -d)"
COOKIE_JAR="$TEMP_DIR/cookies.txt"
CSV_FILE="$TEMP_DIR/smoke-export.csv"
LOGGED_IN=false
SCRAPE_IDS=()
JOB_IDS=()

if [[ -z "${ADMIN_EMAIL:-}" || -z "${ADMIN_PASSWORD:-}" ]]; then
  echo "ADMIN_EMAIL and ADMIN_PASSWORD are required"
  exit 1
fi

for command in curl node; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required"; exit 1; }
done

json_field() {
  local path="$1"
  node -e '
    const fs = require("node:fs")
    const path = process.argv[1].split(".")
    let value = JSON.parse(fs.readFileSync(0, "utf8"))
    for (const key of path) value = value?.[key]
    if (value === undefined || value === null) process.exit(1)
    process.stdout.write(typeof value === "string" ? value : JSON.stringify(value))
  ' "$path"
}

assert_json() {
  local expression="$1"
  node -e '
    const fs = require("node:fs")
    const response = JSON.parse(fs.readFileSync(0, "utf8"))
    const check = new Function("response", `return Boolean(${process.argv[1]})`)
    if (!check(response)) process.exit(1)
  ' "$expression"
}

cleanup() {
  local exit_code=$?
  trap - EXIT
  set +e

  if [[ "$KEEP_SMOKE_ARTIFACTS" != "true" && "$LOGGED_IN" == "true" ]]; then
    for job_id in "${JOB_IDS[@]:-}"; do
      [[ -n "$job_id" ]] || continue
      curl -sS -o /dev/null -b "$COOKIE_JAR" -X POST "$BASE_URL/api/scrape-jobs/$job_id/cancel"
    done
    for scrape_id in "${SCRAPE_IDS[@]:-}"; do
      [[ -n "$scrape_id" ]] || continue
      curl -sS -o /dev/null -b "$COOKIE_JAR" -X DELETE "$BASE_URL/api/scrape/$scrape_id"
    done
  fi

  rm -rf "$TEMP_DIR"
  exit "$exit_code"
}
trap cleanup EXIT

echo "[1/10] Login to $BASE_URL"
LOGIN_BODY="$(ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" node -e '
  process.stdout.write(JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }))
')"
LOGIN_STATUS="$(curl -sS -o "$TEMP_DIR/login.json" -w "%{http_code}" \
  -c "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  --data-binary "$LOGIN_BODY")"
[[ "$LOGIN_STATUS" == "200" ]] || { echo "Login failed: HTTP $LOGIN_STATUS"; cat "$TEMP_DIR/login.json"; exit 1; }
LOGGED_IN=true

echo "[2/10] Verify production health, scheduler history, and credentials"
HEALTH_STATUS="$(curl -sS -o "$TEMP_DIR/health.json" -w "%{http_code}" -b "$COOKIE_JAR" "$BASE_URL/api/health")"
[[ "$HEALTH_STATUS" == "200" ]] || { echo "Health check failed: HTTP $HEALTH_STATUS"; cat "$TEMP_DIR/health.json"; exit 1; }
assert_json 'response.status !== "error" && response.checks?.github?.status === "ok" && response.checks?.database?.status === "ok" && response.checks?.databaseSchema?.status === "ok" && response.checks?.scrapeWorker?.status === "ok" && response.checks?.keepalive?.status === "ok"' < "$TEMP_DIR/health.json" || {
  echo "Health response did not confirm GitHub, Supabase, schema version, keepalive, and worker scheduling"
  cat "$TEMP_DIR/health.json"
  exit 1
}

echo "[3/10] Verify authenticated keepalive when CRON_SECRET is available"
if [[ -n "${CRON_SECRET:-}" ]]; then
  KEEPALIVE_STATUS="$(curl -sS -o "$TEMP_DIR/keepalive.json" -w "%{http_code}" \
    -H "Authorization: Bearer $CRON_SECRET" "$BASE_URL/api/keepalive")"
  [[ "$KEEPALIVE_STATUS" == "200" ]] || { echo "Keepalive failed: HTTP $KEEPALIVE_STATUS"; cat "$TEMP_DIR/keepalive.json"; exit 1; }
  assert_json 'response.success === true && typeof response.timestamp === "string"' < "$TEMP_DIR/keepalive.json"
else
  echo "CRON_SECRET not provided; persistent keepalive history was verified through /api/health"
fi

echo "[4/10] Queue and cancel a scrape: $SMOKE_CANCEL_REPO"
CANCEL_START_BODY="$(SMOKE_TARGET="$SMOKE_CANCEL_REPO" node -e '
  process.stdout.write(JSON.stringify({ type: "repository", target: process.env.SMOKE_TARGET, minContributions: 1 }))
')"
CANCEL_START_RESPONSE="$(curl -sS -b "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/scrape" \
  -H "Content-Type: application/json" \
  --data-binary "$CANCEL_START_BODY")"
CANCEL_SCRAPE_ID="$(printf '%s' "$CANCEL_START_RESPONSE" | json_field scrapeId || true)"
CANCEL_JOB_ID="$(printf '%s' "$CANCEL_START_RESPONSE" | json_field jobId || true)"
[[ -n "$CANCEL_SCRAPE_ID" && -n "$CANCEL_JOB_ID" ]] || { echo "Cancellation scrape did not queue: $CANCEL_START_RESPONSE"; exit 1; }
SCRAPE_IDS+=("$CANCEL_SCRAPE_ID")
JOB_IDS+=("$CANCEL_JOB_ID")

CANCEL_RESPONSE="$(curl -sS -b "$COOKIE_JAR" -X POST "$BASE_URL/api/scrape-jobs/$CANCEL_JOB_ID/cancel")"
printf '%s' "$CANCEL_RESPONSE" | assert_json 'response.job?.status === "canceled"' || {
  echo "Cancellation failed: $CANCEL_RESPONSE"
  exit 1
}
sleep "$CANCEL_SETTLE_SECONDS"
CANCELED_SCRAPE="$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/scrape/$CANCEL_SCRAPE_ID?page=1&pageSize=1")"
printf '%s' "$CANCELED_SCRAPE" | assert_json 'response.status === "canceled"' || {
  echo "Canceled scrape did not remain canceled: $CANCELED_SCRAPE"
  exit 1
}

echo "[5/10] Retry the canceled scrape"
RETRY_RESPONSE="$(curl -sS -b "$COOKIE_JAR" -X POST "$BASE_URL/api/scrape-jobs/$CANCEL_JOB_ID/retry")"
printf '%s' "$RETRY_RESPONSE" | assert_json 'response.job?.id && typeof response.workerTriggered === "boolean"' || {
  echo "Retry failed: $RETRY_RESPONSE"
  exit 1
}
RETRY_STATUS="$(printf '%s' "$RETRY_RESPONSE" | json_field workerResult.status || true)"
if [[ "$RETRY_STATUS" != "succeeded" ]]; then
  curl -sS -o /dev/null -b "$COOKIE_JAR" -X POST "$BASE_URL/api/scrape-jobs/$CANCEL_JOB_ID/cancel"
fi

echo "[6/10] Queue the completion scrape: $SMOKE_REPO"
START_BODY="$(SMOKE_TARGET="$SMOKE_REPO" node -e '
  process.stdout.write(JSON.stringify({ type: "repository", target: process.env.SMOKE_TARGET, minContributions: 1 }))
')"
START_RESPONSE="$(curl -sS -b "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/scrape" \
  -H "Content-Type: application/json" \
  --data-binary "$START_BODY")"
SCRAPE_ID="$(printf '%s' "$START_RESPONSE" | json_field scrapeId || true)"
JOB_ID="$(printf '%s' "$START_RESPONSE" | json_field jobId || true)"
[[ -n "$SCRAPE_ID" && -n "$JOB_ID" ]] || { echo "Scrape did not queue: $START_RESPONSE"; exit 1; }
SCRAPE_IDS+=("$SCRAPE_ID")
JOB_IDS+=("$JOB_ID")

echo "[7/10] Wait for queued -> running -> completed: $SCRAPE_ID"
for ((poll = 1; poll <= MAX_POLLS; poll++)); do
  RESPONSE="$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/scrape/$SCRAPE_ID?page=1&pageSize=500")"
  SCRAPE_STATUS="$(printf '%s' "$RESPONSE" | json_field status || true)"
  if [[ "$SCRAPE_STATUS" == "completed" ]]; then
    printf '%s' "$RESPONSE" > "$TEMP_DIR/contributors.json"
    echo "Scrape completed after $poll poll(s)"
    break
  fi
  if [[ "$SCRAPE_STATUS" == "failed" || "$SCRAPE_STATUS" == "canceled" ]]; then
    echo "Scrape ended unsuccessfully: $RESPONSE"
    exit 1
  fi
  if [[ "$poll" == "$MAX_POLLS" ]]; then
    echo "Timed out waiting for scrape completion; last response: $RESPONSE"
    exit 1
  fi
  sleep "$POLL_SECONDS"
done

echo "[8/10] Validate contributors and generate CSV with Talon's exporter"
assert_json 'Array.isArray(response.contributors) && Number.isFinite(response.contributorTotal)' < "$TEMP_DIR/contributors.json"
CSV_OUTPUT="$CSV_FILE" node --experimental-strip-types --input-type=module -e '
  import fs from "node:fs"
  const { buildCsvContent, hasExportableContact } = await import("./lib/csv-export.ts")
  const response = JSON.parse(fs.readFileSync(0, "utf8"))
  const csv = buildCsvContent(response.contributors.filter(hasExportableContact))
  if (!csv.startsWith("#,Name,Username,GitHub Profile,Contributions,")) process.exit(1)
  fs.writeFileSync(process.env.CSV_OUTPUT, csv)
' < "$TEMP_DIR/contributors.json"
[[ -s "$CSV_FILE" ]] || { echo "CSV export was empty"; exit 1; }

echo "[9/10] Create and verify a public read-only share"
SHARE_RESPONSE="$(curl -sS -b "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/share" \
  -H "Content-Type: application/json" \
  --data-binary "$(SCRAPE_ID="$SCRAPE_ID" node -e 'process.stdout.write(JSON.stringify({ scrapeId: process.env.SCRAPE_ID, expiresInDays: 1, allowDownload: true }))')")"
SHARE_TOKEN="$(printf '%s' "$SHARE_RESPONSE" | json_field token || true)"
SHARE_ID="$(printf '%s' "$SHARE_RESPONSE" | json_field share.id || true)"
[[ -n "$SHARE_TOKEN" && -n "$SHARE_ID" ]] || { echo "Share creation failed: $SHARE_RESPONSE"; exit 1; }
PUBLIC_SHARE="$(curl -sS "$BASE_URL/api/share/$SHARE_TOKEN")"
printf '%s' "$PUBLIC_SHARE" | SCRAPE_ID="$SCRAPE_ID" node -e '
  const fs = require("node:fs")
  const response = JSON.parse(fs.readFileSync(0, "utf8"))
  if (response.id !== process.env.SCRAPE_ID || !Array.isArray(response.contributors)) process.exit(1)
  if (response.share?.allowDownload !== true || !response.share?.expiresAt) process.exit(1)
  if (response.contributors.some((contributor) =>
    "notes" in contributor || "status" in contributor || "contacted" in contributor || "contactedDate" in contributor
  )) process.exit(1)
'
REVOKE_STATUS="$(curl -sS -o "$TEMP_DIR/revoke-share.json" -w "%{http_code}" -b "$COOKIE_JAR" \
  -X DELETE "$BASE_URL/api/share" \
  -H "Content-Type: application/json" \
  --data-binary "$(SHARE_ID="$SHARE_ID" node -e 'process.stdout.write(JSON.stringify({ shareId: process.env.SHARE_ID }))')")"
[[ "$REVOKE_STATUS" == "200" ]] || { echo "Share revocation failed: $(cat "$TEMP_DIR/revoke-share.json")"; exit 1; }
REVOKED_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/share/$SHARE_TOKEN")"
[[ "$REVOKED_STATUS" == "410" ]] || { echo "Revoked share returned HTTP $REVOKED_STATUS instead of 410"; exit 1; }

echo "[10/10] Clean up smoke artifacts"
if [[ "$KEEP_SMOKE_ARTIFACTS" == "true" ]]; then
  echo "KEEP_SMOKE_ARTIFACTS=true; leaving $CANCEL_SCRAPE_ID and $SCRAPE_ID in Talon"
else
  cleanup_status=0
  for job_id in "$CANCEL_JOB_ID" "$JOB_ID"; do
    curl -sS -o /dev/null -b "$COOKIE_JAR" -X POST "$BASE_URL/api/scrape-jobs/$job_id/cancel" || cleanup_status=1
  done
  for scrape_id in "$CANCEL_SCRAPE_ID" "$SCRAPE_ID"; do
    DELETE_STATUS="$(curl -sS -o "$TEMP_DIR/delete.json" -w "%{http_code}" -b "$COOKIE_JAR" -X DELETE "$BASE_URL/api/scrape/$scrape_id")"
    [[ "$DELETE_STATUS" == "200" ]] || cleanup_status=1
  done
  [[ "$cleanup_status" == "0" ]] || { echo "Smoke passed, but cleanup needs attention"; exit 1; }
  SCRAPE_IDS=()
  JOB_IDS=()
fi

echo "Production smoke passed for $BASE_URL"
