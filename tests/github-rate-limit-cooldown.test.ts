import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/037_github_rate_limit_cooldown.sql"),
  "utf8"
)
const claimStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.claim_scrape_job")
const claimFunction = migration.slice(
  claimStart,
  migration.indexOf("-- Combine failure handling", claimStart)
)
const failureStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.fail_scrape_job_step_with_github_cooldown")
const failureFunction = migration.slice(
  failureStart,
  migration.indexOf("REVOKE ALL ON FUNCTION public.claim_scrape_job", failureStart)
)

test("the shared GitHub cooldown is private operational state", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.service_cooldowns/i)
  assert.match(migration, /service TEXT PRIMARY KEY CHECK \(service = 'github'\)/i)
  assert.match(migration, /ALTER TABLE public\.service_cooldowns ENABLE ROW LEVEL SECURITY/i)
  assert.match(migration, /REVOKE ALL ON TABLE public\.service_cooldowns FROM anon, authenticated/i)
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]+service_cooldowns/i)
})

test("atomic claims stop before consuming attempts during an active cooldown", () => {
  const cooldownGate = claimFunction.indexOf("blocked_until > NOW()")
  const jobSelection = claimFunction.indexOf("SELECT * INTO claimed_job")
  const attemptIncrement = claimFunction.indexOf("attempts = claimed_job.attempts + 1")

  assert.ok(cooldownGate > 0)
  assert.ok(jobSelection > cooldownGate)
  assert.ok(attemptIncrement > jobSelection)
  assert.match(claimFunction, /FOR UPDATE SKIP LOCKED/i)
})

test("rate-limit failure and cooldown activation share the active worker transaction", () => {
  assert.match(failureFunction, /FROM public\.scrape_jobs[\s\S]+FOR UPDATE/i)
  assert.match(failureFunction, /current_job\.locked_by IS DISTINCT FROM p_worker_id/i)
  assert.match(failureFunction, /current_job\.cancel_requested/i)
  assert.match(failureFunction, /INSERT INTO public\.service_cooldowns AS existing/i)
  assert.match(failureFunction, /GREATEST\(existing\.blocked_until, EXCLUDED\.blocked_until\)/i)
  assert.match(failureFunction, /'githubCooldownUntil', p_cooldown_until/i)
})

test("cooldown functions are service-role only and advance the schema contract", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.fail_scrape_job_step_with_github_cooldown[\s\S]+FROM PUBLIC/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.fail_scrape_job_step_with_github_cooldown[\s\S]+TO service_role/i)
  assert.match(migration, /VALUES \(37, 'github_rate_limit_cooldown'\)/i)
})
