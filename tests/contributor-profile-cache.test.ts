import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/036_contributor_profile_freshness_cache.sql"),
  "utf8"
)
const runner = readFileSync(resolve(import.meta.dirname, "../lib/scrape-runner.ts"), "utf8")
const hydrationStart = runner.indexOf("async function hydrateCandidates")
const hydrationBody = runner.slice(hydrationStart, runner.indexOf("async function scrapeOrganization", hydrationStart))
const cachedFunctionStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.checkpoint_cached_scrape_hydration_batch")
const cachedFunction = migration.slice(
  cachedFunctionStart,
  migration.indexOf("REVOKE ALL ON FUNCTION public.checkpoint_cached_scrape_hydration_batch", cachedFunctionStart)
)

test("GitHub profile freshness is separate from recruiter workflow updates", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS profile_refreshed_at TIMESTAMPTZ/i)
  assert.match(migration, /CREATE TRIGGER contributors_profile_refreshed/i)
  assert.match(migration, /BEFORE INSERT OR UPDATE OF[\s\S]+website[\s\S]+ON public\.contributors/i)

  const triggerColumns = migration.slice(
    migration.indexOf("BEFORE INSERT OR UPDATE OF"),
    migration.indexOf("ON public.contributors")
  )
  assert.doesNotMatch(triggerColumns, /contacted|outreach|reminder|status/i)
})

test("cached hydration validates the lease, exact candidates, team, and seven-day freshness", () => {
  assert.match(cachedFunction, /FOR UPDATE/i)
  assert.match(cachedFunction, /current_job\.locked_by IS DISTINCT FROM p_worker_id/i)
  assert.match(cachedFunction, /current_job\.cancel_requested/i)
  assert.match(cachedFunction, /candidate\.contributions <> profile\.contributions/i)
  assert.match(cachedFunction, /contributor\.team_id = current_job\.team_id/i)
  assert.match(cachedFunction, /profile_refreshed_at >= NOW\(\) - INTERVAL '7 days'/i)
})

test("cached hydration links contributors without rewriting or extending cached profiles", () => {
  assert.match(cachedFunction, /INSERT INTO public\.scrape_contributors/i)
  assert.doesNotMatch(cachedFunction, /INSERT INTO public\.contributors/i)
  assert.doesNotMatch(cachedFunction, /UPDATE public\.contributors/i)
  assert.match(cachedFunction, /'cached_contributors_linked'/i)
})

test("the worker checkpoints cached profiles before fetching only the remaining GitHub profiles", () => {
  const cacheRead = hydrationBody.indexOf("getFreshContributorUsernames")
  const cacheCheckpoint = hydrationBody.indexOf("checkpointCachedScrapeHydrationBatch")
  const networkBatch = hydrationBody.indexOf("profilePlan.refresh.map")
  const networkCheckpoint = hydrationBody.indexOf("checkpointScrapeHydrationBatch(job, fulfilled)")

  assert.ok(cacheRead > 0)
  assert.ok(cacheCheckpoint > cacheRead)
  assert.ok(networkBatch > cacheCheckpoint)
  assert.ok(networkCheckpoint > networkBatch)
  assert.match(hydrationBody, /if \(!profilePlan\.refresh\.length\) return step\.completesHydration/)
})

test("the cache checkpoint is service-role only and advances the schema contract", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.checkpoint_cached_scrape_hydration_batch[^;]+ FROM PUBLIC/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.checkpoint_cached_scrape_hydration_batch[^;]+ TO service_role/i)
  assert.match(migration, /VALUES \(36, 'contributor_profile_freshness_cache'\)/i)
})
