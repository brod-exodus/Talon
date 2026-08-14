import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/039_notification_delivery_outbox.sql"),
  "utf8"
)
const scrapeRunner = readFileSync(resolve(import.meta.dirname, "../lib/scrape-runner.ts"), "utf8")
const workerOperation = readFileSync(resolve(import.meta.dirname, "../lib/scrape-worker-operation.ts"), "utf8")

test("watched-repository completion enqueues a deduplicated outbox record in its transaction", () => {
  assert.match(migration, /AFTER INSERT ON public\.activity_events/i)
  assert.match(migration, /WHEN \(NEW\.type = 'watched_repo\.contributors_found'\)/i)
  assert.match(migration, /UNIQUE \(kind, dedupe_key\)/i)
  assert.match(migration, /ON CONFLICT \(kind, dedupe_key\) DO NOTHING/i)
  assert.match(migration, /'watchedRepoId'.*'scrapeId'/is)
  assert.doesNotMatch(migration, /webhook_url|SLACK_WEBHOOK_URL|authorization/i)
})

test("notification claims are atomic, ordered, and skip concurrent leases", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.claim_notification_delivery/i)
  assert.match(migration, /ORDER BY run_after ASC, created_at ASC/i)
  assert.match(migration, /FOR UPDATE SKIP LOCKED/i)
  assert.match(migration, /attempts = claimed\.attempts \+ 1/i)
  assert.match(migration, /locked_by = p_worker_id/i)
})

test("completion and failure require the active delivery lease", () => {
  assert.match(migration, /current_delivery\.status <> 'running'/i)
  assert.ok((migration.match(/current_delivery\.locked_by IS DISTINCT FROM p_worker_id/g) ?? []).length >= 2)
  assert.match(migration, /current_delivery\.attempts >= current_delivery\.max_attempts/i)
  assert.match(migration, /INTERVAL '1 minute' \* POWER/i)
  assert.match(migration, /last_notification_status = CASE WHEN next_status = 'failed' THEN 'failed' ELSE 'retrying' END/i)
})

test("Slack delivery no longer runs inside scrape completion", () => {
  assert.doesNotMatch(scrapeRunner, /deliverWatchedRepoNotification|markWatchedRepoNotificationFailed/)
  const notificationStart = workerOperation.indexOf("runNotificationDeliveryWorker")
  const scrapeStart = workerOperation.indexOf("runScrapeWorker({", notificationStart)
  assert.ok(notificationStart > 0)
  assert.ok(scrapeStart > notificationStart)
  assert.match(workerOperation, /trigger === "cron" \|\| trigger === "manual"/)
})

test("outbox state is private, retained, and advances schema v39", () => {
  assert.match(migration, /ALTER TABLE public\.notification_deliveries ENABLE ROW LEVEL SECURITY/i)
  assert.match(migration, /REVOKE ALL ON TABLE public\.notification_deliveries FROM anon, authenticated/i)
  assert.match(migration, /cleanup_notification_delivery_retention/i)
  assert.match(migration, /updated_at < NOW\(\) - INTERVAL '90 days'/i)
  assert.match(migration, /VALUES \(39, 'notification_delivery_outbox'\)/i)
})
