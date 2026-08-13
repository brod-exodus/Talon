import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/031_atomic_job_claim.sql"),
  "utf8"
)

test("job claim selects one oldest due job while skipping concurrent locks", () => {
  assert.match(migration, /status = 'queued'/i)
  assert.match(migration, /cancel_requested = FALSE/i)
  assert.match(migration, /run_after <= NOW\(\)/i)
  assert.match(migration, /ORDER BY run_after ASC, created_at ASC/i)
  assert.match(migration, /FOR UPDATE SKIP LOCKED/i)
  assert.match(migration, /LIMIT 1/i)
})

test("job claim updates ownership and records its event atomically", () => {
  assert.match(migration, /SET status = 'running'/i)
  assert.match(migration, /attempts = claimed_job\.attempts \+ 1/i)
  assert.match(migration, /locked_by = p_worker_id/i)
  assert.match(migration, /INSERT INTO public\.scrape_job_events/i)
  assert.match(migration, /RETURN NEXT claimed_job/i)
})

test("job claim is service-role only and advances the schema contract", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_scrape_job\(TEXT, UUID\) FROM PUBLIC/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_scrape_job\(TEXT, UUID\) TO service_role/i)
  assert.match(migration, /VALUES \(31, 'atomic_job_claim'\)/i)
})
