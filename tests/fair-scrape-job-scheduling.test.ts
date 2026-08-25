import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema-version.ts"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/047_fair_scrape_job_scheduling.sql"),
  "utf8"
)

test("claim selection prioritizes interactive work and rotates workspaces and jobs", () => {
  assert.match(migration, /scrape\.watched_repo_id IS NULL OR job\.created_at <= NOW\(\) - INTERVAL '15 minutes'\) DESC/i)
  assert.match(migration, /team_event\.team_id = job\.team_id[\s\S]+event_type = 'claimed'/i)
  assert.match(migration, /job_event\.job_id = job\.id[\s\S]+event_type = 'claimed'/i)
  assert.match(migration, /ORDER BY[\s\S]+job\.run_after ASC[\s\S]+job\.created_at ASC/i)
})

test("fair claims preserve cooldown, workspace, cancellation, and row-lock safety", () => {
  const cooldown = migration.indexOf("blocked_until > NOW()")
  const serialization = migration.indexOf("talon-scrape-job-claim")
  const selection = migration.indexOf("SELECT job.* INTO claimed_job")

  assert.ok(serialization > 0 && cooldown > serialization && selection > cooldown)
  assert.match(migration, /p_team_id IS NULL OR job\.team_id = p_team_id/i)
  assert.match(migration, /job\.cancel_requested = FALSE/i)
  assert.match(migration, /FOR UPDATE OF job SKIP LOCKED/i)
  assert.match(migration, /attempts = claimed_job\.attempts \+ 1/i)
})

test("fair scheduling is indexed, attestable, service-role only, and schema v47", () => {
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_scrape_job_events_claimed_team_job_created_at/i)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_talon_scheduling_contract_issues\(\)/i)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_scrape_job\(TEXT, UUID\) FROM PUBLIC/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_scrape_job\(TEXT, UUID\) TO service_role/i)
  assert.match(migration, /VALUES \(47, 'fair_scrape_job_scheduling'\)/i)
  assert.ok(EXPECTED_SCHEMA_VERSION >= 47)
})
