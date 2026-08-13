import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/028_idempotent_scrape_enqueue.sql"),
  "utf8"
)

test("scrape enqueue migration keeps the full command inside one transaction", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.scrape_enqueue_requests/i)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enqueue_scrape/i)
  assert.match(migration, /SECURITY DEFINER/i)
  assert.match(migration, /pg_advisory_xact_lock/i)

  const functionStart = migration.indexOf("CREATE OR REPLACE FUNCTION public.enqueue_scrape")
  const functionEnd = migration.indexOf("REVOKE ALL ON FUNCTION public.enqueue_scrape")
  const functionBody = migration.slice(functionStart, functionEnd)
  for (const table of ["scrapes", "scrape_jobs", "ecosystem_scrapes", "scrape_job_events", "scrape_enqueue_requests"]) {
    assert.match(functionBody, new RegExp(`INSERT INTO public\\.${table}`))
  }
})

test("scrape enqueue keys are team-scoped, replay-safe, and service-role only", () => {
  assert.match(migration, /PRIMARY KEY \(team_id, idempotency_key\)/i)
  assert.match(migration, /Idempotency key was already used for a different scrape request/)
  assert.match(migration, /ALTER TABLE public\.scrape_enqueue_requests ENABLE ROW LEVEL SECURITY/i)
  assert.match(migration, /REVOKE ALL ON TABLE public\.scrape_enqueue_requests FROM anon, authenticated/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.enqueue_scrape[^;]+ TO service_role/i)
  assert.match(migration, /VALUES \(28, 'idempotent_scrape_enqueue'\)/i)
})
