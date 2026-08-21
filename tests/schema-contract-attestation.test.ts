import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema-version.ts"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/043_schema_contract_attestation.sql"),
  "utf8"
)

test("schema attestation checks physical objects instead of trusting only the migration ledger", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_talon_schema_contract_issues\(\)/i)

  for (const object of [
    "project_contributors_cache",
    "scrape_contributors",
    "notification_deliveries",
    "profile_refreshed_at",
    "scrape_contributors_team_scrape_fkey",
    "get_contactable_scrape_contributors_page",
  ]) {
    assert.ok(migration.includes(object), object)
  }

  assert.match(migration, /relation\.relrowsecurity/i)
  assert.match(migration, /constraint_record\.convalidated/i)
  assert.match(
    migration,
    /FROM public\.get_talon_schema_contract_issues\(\)[\s\S]+Talon physical schema contract is incomplete/i
  )
  assert.match(
    migration,
    /public\.enqueue_scrape\(uuid,uuid,text,text,text,integer,uuid,uuid\)/i
  )
  assert.doesNotMatch(migration, /profile_fetched_at/i)
})

test("schema attestation is service-role only and advances the contract to v43", () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.get_talon_schema_contract_issues\(\) FROM PUBLIC/i
  )
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.get_talon_schema_contract_issues\(\) TO service_role/i
  )
  assert.match(migration, /\(43,\s*'schema_contract_attestation'\)/i)
  assert.ok(EXPECTED_SCHEMA_VERSION >= 43)
})
