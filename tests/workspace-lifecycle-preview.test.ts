import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema-version.ts"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/048_workspace_lifecycle_preview.sql"),
  "utf8"
)

test("workspace lifecycle preview is count-only and explicitly team scoped", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.preview_workspace_lifecycle\(p_team_id UUID\)/i)
  assert.match(migration, /RETURNS JSONB[\s\S]+STABLE[\s\S]+SECURITY DEFINER/i)
  assert.doesNotMatch(migration, /\b(email|outreach_notes|reminder_note|github_username|target)\b/i)

  for (const table of [
    "team_memberships", "auth_sessions", "contributors", "scrapes", "scrape_contributors",
    "shared_scrapes", "ecosystems", "ecosystem_scrapes", "project_contributors_cache",
    "project_lists", "project_list_contributors", "project_contributor_tracking", "watched_repos",
    "watched_repo_contributors", "scrape_jobs", "scrape_job_contributions",
    "scrape_job_repository_contributions", "scrape_job_events", "scrape_enqueue_requests",
    "notification_deliveries", "activity_events", "audit_events",
  ]) {
    assert.match(migration, new RegExp(`FROM public\\.${table} WHERE team_id = p_team_id`, "i"), table)
  }
})

test("workspace lifecycle preview detects active work without authorizing deletion", () => {
  assert.match(migration, /'activeScrapes'/)
  assert.match(migration, /'activeScrapeJobs'/)
  assert.match(migration, /'activeNotificationDeliveries'/)
  assert.match(migration, /'activeSharedLinks'/)
  assert.match(migration, /'activeAuthSessions'/)
  assert.match(migration, /'hasActiveWork'/)
  assert.doesNotMatch(migration, /DELETE FROM/i)
})

test("workspace lifecycle preview is service-role only and advances schema v48", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.preview_workspace_lifecycle\(UUID\) FROM PUBLIC, anon, authenticated/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.preview_workspace_lifecycle\(UUID\) TO service_role/i)
  assert.match(migration, /get_talon_lifecycle_contract_issues/i)
  assert.match(migration, /\(48, 'workspace_lifecycle_preview'\)/i)
  assert.equal(EXPECTED_SCHEMA_VERSION, 48)
})
