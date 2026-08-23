import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { resolve } from "node:path"
import { MAX_ACTIVE_AUTH_SESSIONS } from "../lib/session-limits.ts"
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema-version.ts"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/046_bounded_active_sessions.sql"),
  "utf8"
)

test("active-session enforcement serializes concurrent logins per keyed subject", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.enforce_talon_active_session_limit\(\)/i)
  assert.match(
    migration,
    /pg_advisory_xact_lock[\s\S]+NEW\.subject_hash[\s\S]+OFFSET 10[\s\S]+FOR UPDATE/i
  )
  assert.match(migration, /CREATE TRIGGER auth_sessions_enforce_active_limit[\s\S]+AFTER INSERT/i)
})

test("migration repairs existing excess and records an explicit revocation reason", () => {
  assert.match(migration, /ROW_NUMBER\(\) OVER[\s\S]+PARTITION BY subject_hash/i)
  assert.match(migration, /subject_rank > 10/i)
  assert.match(migration, /revoke_reason = 'session_limit'/i)
  assert.match(migration, /revoke_reason IN \('logout', 'password_change', 'operator', 'session_limit'\)/i)
})

test("the trigger and live data invariant are continuously attestable", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_talon_session_limit_contract_issues\(\)/i)
  assert.match(migration, /trigger_record\.tgenabled <> 'D'/i)
  assert.match(migration, /HAVING COUNT\(\*\) > 10/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_talon_session_limit_contract_issues\(\) TO service_role/i)
})

test("application retains the schema v46 active-session contract", () => {
  assert.equal(MAX_ACTIVE_AUTH_SESSIONS, 10)
  assert.match(migration, /\(46,\s*'bounded_active_sessions'\)/i)
  assert.ok(EXPECTED_SCHEMA_VERSION >= 46)
})
