import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/030_lease_safe_job_transitions.sql"),
  "utf8"
)

test("worker transitions require the current running lease", () => {
  for (const functionName of ["yield_scrape_job", "fail_scrape_job_step", "complete_scrape_job"]) {
    const start = migration.indexOf(`FUNCTION public.${functionName}`)
    assert.notEqual(start, -1)
    const body = migration.slice(start, migration.indexOf("$$;", start))
    assert.match(body, /FOR UPDATE/i)
    assert.match(body, /current_job\.status <> 'running'/i)
    assert.match(body, /current_job\.locked_by IS DISTINCT FROM p_worker_id/i)
    assert.match(body, /current_job\.cancel_requested/i)
  }
})

test("operator and stale recovery transitions lock the job before updating its scrape", () => {
  for (const functionName of ["cancel_scrape_job", "retry_scrape_job", "recover_stale_scrape_job"]) {
    const start = migration.indexOf(`FUNCTION public.${functionName}`)
    assert.notEqual(start, -1)
    const body = migration.slice(start, migration.indexOf("$$;", start))
    assert.match(body, /FOR UPDATE/i)
    assert.match(body, /UPDATE public\.scrape_jobs/i)
    assert.match(body, /UPDATE public\.scrapes/i)
  }
})

test("terminal transitions update the job and scrape in one database transaction", () => {
  assert.match(migration, /FUNCTION public\.complete_scrape_job[\s\S]+UPDATE public\.scrapes[\s\S]+UPDATE public\.scrape_jobs/i)
  assert.match(migration, /FUNCTION public\.fail_scrape_job_step[\s\S]+IF p_next_status = 'failed'[\s\S]+UPDATE public\.scrapes/i)
  assert.match(migration, /completed_at = NOW\(\)/i)
  assert.match(migration, /VALUES \(30, 'lease_safe_job_transitions'\)/i)
})

test("lease transition functions are service-role only", () => {
  for (const functionName of [
    "yield_scrape_job",
    "fail_scrape_job_step",
    "complete_scrape_job",
    "cancel_scrape_job",
    "retry_scrape_job",
    "recover_stale_scrape_job",
  ]) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${functionName}[^;]+ FROM PUBLIC`, "i"))
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${functionName}[^;]+ TO service_role`, "i"))
  }
})
