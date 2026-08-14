import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/035_verified_scrape_completion.sql"),
  "utf8"
)
const database = readFileSync(resolve(import.meta.dirname, "../lib/db.ts"), "utf8")
const completionStart = database.indexOf("export async function completeScrape")
const completionBody = database.slice(completionStart, database.indexOf("export type AppScrape", completionStart))

test("verified completion locks and validates the active hydration lease before counting", () => {
  const lock = migration.indexOf("FOR UPDATE")
  const leaseGuard = migration.indexOf("current_job.status <> 'running'")
  const phaseGuard = migration.indexOf("Scrape job is not ready for completion")
  const candidateCount = migration.indexOf("SELECT COUNT(*) INTO candidate_count")

  assert.ok(lock > 0)
  assert.ok(leaseGuard > lock)
  assert.ok(phaseGuard > leaseGuard)
  assert.ok(candidateCount > phaseGuard)
  assert.match(migration, /current_job\.locked_by IS DISTINCT FROM p_worker_id/i)
  assert.match(migration, /current_job\.cancel_requested/i)
})

test("completion requires every eligible candidate and no extra scrape links", () => {
  assert.match(migration, /candidate\.contributions >= current_job\.min_contributions/i)
  assert.match(migration, /link\.contributions = candidate\.contributions/i)
  assert.match(migration, /linked_candidate_count <> candidate_count/i)
  assert.match(migration, /calculated_contributor_total <> candidate_count/i)
  assert.match(migration, /Scrape hydration is incomplete/i)
})

test("the database derives contact totals and commits all terminal records together", () => {
  const derivedCounts = migration.indexOf("INTO calculated_contributor_total, calculated_contact_info_count")
  const scrapeUpdate = migration.indexOf("UPDATE public.scrapes", derivedCounts)
  const jobUpdate = migration.indexOf("UPDATE public.scrape_jobs", scrapeUpdate)
  const jobEvent = migration.indexOf("INSERT INTO public.scrape_job_events", jobUpdate)
  const activityEvent = migration.indexOf("INSERT INTO public.activity_events", jobEvent)

  assert.ok(derivedCounts > 0)
  assert.ok(scrapeUpdate > derivedCounts)
  assert.ok(jobUpdate > scrapeUpdate)
  assert.ok(jobEvent > jobUpdate)
  assert.ok(activityEvent > jobEvent)
  assert.match(migration, /contact_info_count = calculated_contact_info_count/i)
  assert.match(migration, /total_contributors = calculated_contributor_total/i)
  assert.match(migration, /'scrape\.completed'/i)
})

test("the application calls verified completion without supplying trusted totals", () => {
  assert.match(completionBody, /rpc\("complete_scrape_job_verified", \{/)
  assert.match(completionBody, /p_job_id: job\.id/)
  assert.match(completionBody, /p_worker_id: workerId/)
  assert.doesNotMatch(completionBody, /p_contributor_total|p_contact_info_count/)
  assert.doesNotMatch(database, /getScrapeContributorStats|persistScrapeContributors/)
})

test("derived cache refresh failures are contained after the terminal transition", () => {
  const transition = completionBody.indexOf("if (!transition.applied) return transition")
  const cacheTry = completionBody.indexOf("try {", transition)
  const cacheLog = completionBody.indexOf('logError("scrape.project_cache_refresh_failed"', cacheTry)
  const result = completionBody.lastIndexOf("return transition")

  assert.ok(transition > 0)
  assert.ok(cacheTry > transition)
  assert.ok(cacheLog > cacheTry)
  assert.ok(result > cacheLog)
})

test("verified completion is service-role only and advances the schema contract", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.complete_scrape_job_verified[^;]+ FROM PUBLIC/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.complete_scrape_job_verified[^;]+ TO service_role/i)
  assert.match(migration, /VALUES \(35, 'verified_scrape_completion'\)/i)
})
