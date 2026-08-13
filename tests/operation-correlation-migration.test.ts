import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/029_operation_correlation.sql"),
  "utf8"
)

test("operation correlation migration covers every persistent diagnostic boundary", () => {
  for (const table of ["audit_events", "system_runs", "scrape_jobs", "scrape_job_events", "scrape_enqueue_requests"]) {
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS request_id UUID`, "i"))
  }
  for (const table of ["audit_events", "system_runs", "scrape_jobs", "scrape_job_events"]) {
    assert.match(migration, new RegExp(`ON public\\.${table}\\(request_id\\)`, "i"))
  }
})

test("operation correlation keeps the enqueue RPC rollback-compatible and service-role only", () => {
  assert.match(migration, /p_request_id UUID DEFAULT NULL/i)
  assert.match(migration, /origin_request_id UUID/i)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.enqueue_scrape[^;]+ FROM PUBLIC/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.enqueue_scrape[^;]+ TO service_role/i)
  assert.match(migration, /VALUES \(29, 'operation_correlation'\)/i)
})
