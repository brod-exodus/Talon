import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/032_lease_safe_job_checkpoints.sql"),
  "utf8"
)
const runner = readFileSync(resolve(import.meta.dirname, "../lib/scrape-runner.ts"), "utf8")

test("checkpoints lock and validate the active worker lease before writing", () => {
  const lock = migration.indexOf("FOR UPDATE")
  const leaseGuard = migration.indexOf("current_job.status <> 'running'")
  const jobUpdate = migration.indexOf("UPDATE public.scrape_jobs")
  const scrapeUpdate = migration.indexOf("UPDATE public.scrapes")

  assert.ok(lock > 0)
  assert.ok(leaseGuard > lock)
  assert.ok(jobUpdate > leaseGuard)
  assert.ok(scrapeUpdate > jobUpdate)
  assert.match(migration, /current_job\.locked_by IS DISTINCT FROM p_worker_id/i)
  assert.match(migration, /current_job\.cancel_requested/i)
})

test("checkpoint state and progress are committed in one database transaction", () => {
  assert.match(migration, /SET state = COALESCE\(p_state, state\)/i)
  assert.match(migration, /SET progress = p_progress[\s\S]+current = p_current[\s\S]+total = p_total/i)
  assert.match(migration, /WHERE id = current_job\.scrape_id[\s\S]+AND team_id = current_job\.team_id/i)
  assert.match(migration, /RETURN QUERY SELECT TRUE, 'running'::TEXT/i)
})

test("the worker uses the lease-safe checkpoint instead of direct cursor or progress writes", () => {
  assert.match(runner, /checkpointScrapeJob/)
  assert.match(runner, /saveScrapeCheckpoint/)
  assert.doesNotMatch(runner, /updateScrapeJobState|updateScrapeProgress/)
})

test("checkpoint access is service-role only and advances the schema contract", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.checkpoint_scrape_job[^;]+ FROM PUBLIC/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.checkpoint_scrape_job[^;]+ TO service_role/i)
  assert.match(migration, /VALUES \(32, 'lease_safe_job_checkpoints'\)/i)
})
