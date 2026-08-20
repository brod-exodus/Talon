import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema-version.ts"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/042_workspace_referential_integrity.sql"),
  "utf8"
)

test("workspace integrity migration serializes concurrent SQL Editor runs", () => {
  assert.match(
    migration,
    /pg_advisory_xact_lock\(hashtextextended\('talon-schema-migration', 0\)\)/i
  )
})

test("workspace integrity migration rejects existing cross-workspace relationships before changing constraints", () => {
  assert.match(migration, /to_regclass\(requirement\.relation_name\) IS NULL/i)
  assert.match(migration, /'public\.project_contributors_cache', '013'/i)
  assert.match(migration, /Required table % is missing\. Apply migration % before migration 042/i)

  for (const relation of [
    "scrape_contributors -> scrapes/contributors",
    "scrape_jobs -> scrapes",
    "scrape_job_events -> scrape_jobs/scrapes",
    "ecosystem_scrapes -> ecosystems/scrapes",
    "project_list_contributors -> lists/contributors",
    "project_contributor_tracking -> ecosystems/contributors",
    "watched_repo_contributors -> watched_repos/scrapes",
  ]) {
    assert.match(migration, new RegExp(relation.replace(/[/-]/g, "\\$&"), "i"))
  }
  assert.match(migration, /Workspace referential-integrity violation found in/i)
})

test("workspace-owned links use composite foreign keys instead of trusting application filters", () => {
  for (const constraint of [
    "scrape_contributors_team_scrape_fkey",
    "scrape_contributors_team_contributor_fkey",
    "scrape_jobs_team_scrape_fkey",
    "scrape_job_events_team_job_scrape_fkey",
    "shared_scrapes_team_scrape_fkey",
    "ecosystem_scrapes_team_ecosystem_fkey",
    "ecosystem_scrapes_team_scrape_fkey",
    "project_list_contributors_team_list_fkey",
    "project_list_contributors_team_contributor_fkey",
    "project_contributor_tracking_team_ecosystem_fkey",
    "project_contributor_tracking_team_contributor_fkey",
    "scrape_enqueue_requests_team_job_scrape_fkey",
    "scrapes_team_watched_repo_fkey",
    "watched_repo_contributors_team_watched_repo_fkey",
  ]) {
    assert.match(migration, new RegExp(`ADD CONSTRAINT ${constraint}`, "i"), constraint)
    assert.match(migration, new RegExp(`VALIDATE CONSTRAINT ${constraint}`, "i"), constraint)
  }
})

test("legacy scrape contributor inserts receive a database-derived team id", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS team_id UUID/i)
  assert.match(migration, /BEFORE INSERT OR UPDATE OF scrape_id, team_id/i)
  assert.match(migration, /SELECT scrape\.team_id[\s\S]+INTO NEW\.team_id/i)
  assert.match(migration, /ALTER COLUMN team_id SET NOT NULL/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.set_scrape_contributor_team_id\(\) TO service_role/i)
  assert.doesNotMatch(migration, /NEW\.team_id\s*:=\s*NEW\./i)
})

test("workspace integrity advances the database contract to schema v42", () => {
  assert.match(migration, /\(42,\s*'workspace_referential_integrity'\)/i)
  assert.equal(EXPECTED_SCHEMA_VERSION, 42)
})
