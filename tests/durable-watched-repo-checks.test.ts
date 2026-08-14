import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/038_durable_watched_repo_checks.sql"),
  "utf8"
)
const database = readFileSync(resolve(import.meta.dirname, "../lib/db.ts"), "utf8")
const watchedUi = readFileSync(resolve(import.meta.dirname, "../components/watched-repos.tsx"), "utf8")

test("watched checks use one resumable internal scrape at a time", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS watched_repo_id UUID/i)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_scrapes_one_active_watch_check/i)
  assert.match(migration, /WHERE watched_repo_id IS NOT NULL AND status = 'active'/i)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enqueue_due_watched_repo_scrapes/i)
  assert.match(migration, /FOR UPDATE OF watch SKIP LOCKED/i)
})

test("the scheduler honors intervals and records durable check status", () => {
  assert.match(migration, /make_interval\(hours => watch\.interval_hours\)/i)
  assert.match(migration, /check_status = 'queued'/i)
  assert.match(migration, /check_status = 'running'/i)
  assert.match(migration, /check_status = 'succeeded'/i)
  assert.match(migration, /check_status = 'failed'/i)
  assert.match(migration, /last_check_completed_at = NOW\(\)/i)
})

test("completion atomically baselines or records only newly detected contributors", () => {
  assert.match(migration, /ON CONFLICT \(watched_repo_id, github_username\) DO NOTHING/i)
  assert.match(migration, /GET DIAGNOSTICS inserted_watch_contributors = ROW_COUNT/i)
  assert.match(migration, /is_initial_baseline := current_watch\.last_checked_at IS NULL/i)
  assert.match(migration, /'watched_repo\.contributors_found'/i)
})

test("internal checks stay out of normal scrape lists and SLOs", () => {
  assert.ok((database.match(/\.is\("watched_repo_id", null\)/g) ?? []).length >= 5)
  assert.doesNotMatch(watchedUi, /localStorage|AbortController/)
  assert.match(watchedUi, /window\.setInterval\(\(\) => void fetchRepos\(\), 2000\)/)
})

test("durable watch functions are service-role only and advance schema v38", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.enqueue_due_watched_repo_scrapes[^;]+ FROM PUBLIC/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.enqueue_due_watched_repo_scrapes[^;]+ TO service_role/i)
  assert.match(migration, /VALUES \(38, 'durable_watched_repo_checks'\)/i)
})
