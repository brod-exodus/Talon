import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema-version.ts"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/044_append_only_operational_history.sql"),
  "utf8"
)

test("application roles cannot rewrite or directly delete operational history", () => {
  assert.match(
    migration,
    /REVOKE UPDATE, DELETE, TRUNCATE[\s\S]+public\.audit_events, public\.scrape_job_events[\s\S]+service_role/i
  )
  assert.match(
    migration,
    /GRANT SELECT, INSERT[\s\S]+public\.audit_events, public\.scrape_job_events[\s\S]+service_role/i
  )
})

test("append-only privileges are continuously attestable without disabling retention", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_talon_append_only_contract_issues\(\)/i)
  assert.match(migration, /has_table_privilege/i)
  assert.match(migration, /has_function_privilege[\s\S]+cleanup_talon_retention/i)
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.get_talon_append_only_contract_issues\(\) TO service_role/i
  )
})

test("append-only operational history advances the schema contract to v44", () => {
  assert.match(migration, /\(44,\s*'append_only_operational_history'\)/i)
  assert.equal(EXPECTED_SCHEMA_VERSION, 44)
})
