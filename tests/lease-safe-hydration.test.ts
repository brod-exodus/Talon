import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(resolve(import.meta.dirname, "../db/migrations/034_lease_safe_hydration.sql"), "utf8")
const runner = readFileSync(resolve(import.meta.dirname, "../lib/scrape-runner.ts"), "utf8")
const hydrationStart = runner.indexOf("async function hydrateCandidates")
const hydrationBody = runner.slice(hydrationStart, runner.indexOf("async function scrapeOrganization", hydrationStart))

test("hydration locks and validates the active worker before any contributor write", () => {
  const lock = migration.indexOf("FOR UPDATE")
  const leaseGuard = migration.indexOf("current_job.status <> 'running'")
  const phaseGuard = migration.indexOf("Scrape job is not ready for hydration")
  const contributorWrite = migration.indexOf("INSERT INTO public.contributors")

  assert.ok(lock > 0)
  assert.ok(leaseGuard > lock)
  assert.ok(phaseGuard > leaseGuard)
  assert.ok(contributorWrite > phaseGuard)
  assert.match(migration, /current_job\.locked_by IS DISTINCT FROM p_worker_id/i)
  assert.match(migration, /current_job\.cancel_requested/i)
  assert.match(migration, /current_job\.state ->> 'phase' IS DISTINCT FROM 'hydrate'/i)
})

test("hydration accepts only a bounded batch of exact persisted job candidates", () => {
  assert.match(migration, /JSONB_ARRAY_LENGTH\(p_contributors\) < 1/i)
  assert.match(migration, /JSONB_ARRAY_LENGTH\(p_contributors\) > 20/i)
  assert.match(migration, /OCTET_LENGTH\(p_contributors::TEXT\) > 1048576/i)
  assert.match(migration, /candidate\.job_id = current_job\.id/i)
  assert.match(migration, /candidate\.contributions < current_job\.min_contributions/i)
  assert.match(migration, /candidate\.contributions <> profile\.contributions/i)
})

test("profiles, scrape links, measured progress, and the event share one transaction", () => {
  const profileWrite = migration.indexOf("INSERT INTO public.contributors")
  const linkWrite = migration.indexOf("INSERT INTO public.scrape_contributors", profileWrite)
  const processedQuery = migration.indexOf("SELECT COUNT(*) INTO processed_count", linkWrite)
  const progressWrite = migration.indexOf("UPDATE public.scrapes", processedQuery)
  const eventWrite = migration.indexOf("INSERT INTO public.scrape_job_events", progressWrite)

  assert.ok(profileWrite > 0)
  assert.ok(linkWrite > profileWrite)
  assert.ok(processedQuery > linkWrite)
  assert.ok(progressWrite > processedQuery)
  assert.ok(eventWrite > progressWrite)
  assert.match(migration, /JOIN public\.scrape_contributors AS link/i)
  assert.match(migration, /progress = LEAST\(99, calculated_progress\)/i)
  assert.match(migration, /'contributors_persisted'/i)
})

test("the worker checkpoints only fulfilled profiles and advances no speculative progress", () => {
  const settled = hydrationBody.indexOf("Promise.allSettled")
  const checkpoint = hydrationBody.indexOf("checkpointScrapeHydrationBatch(job, fulfilled)")
  const rejection = hydrationBody.indexOf('if (rejected?.status === "rejected")')

  assert.ok(settled > 0)
  assert.ok(checkpoint > settled)
  assert.ok(rejection > checkpoint)
  assert.doesNotMatch(hydrationBody, /persistScrapeContributors/)
  assert.doesNotMatch(hydrationBody, /saveScrapeCheckpoint/)
})

test("the hydration checkpoint is service-role only and advances the schema contract", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.checkpoint_scrape_hydration_batch[^;]+ FROM PUBLIC/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.checkpoint_scrape_hydration_batch[^;]+ TO service_role/i)
  assert.match(migration, /VALUES \(34, 'lease_safe_hydration'\)/i)
})
