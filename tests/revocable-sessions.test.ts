import { readFileSync } from "node:fs"
import assert from "node:assert/strict"
import test from "node:test"
import { resolve } from "node:path"
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema-version.ts"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/045_revocable_sessions.sql"),
  "utf8"
)

test("session registry is private, revocable, and contains no raw identity or token", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.auth_sessions/i)
  assert.match(migration, /session_id UUID PRIMARY KEY/i)
  assert.match(migration, /subject_hash TEXT NOT NULL/i)
  assert.doesNotMatch(migration, /\bemail\s+TEXT/i)
  assert.doesNotMatch(migration, /\btoken\s+TEXT/i)
  assert.match(migration, /ALTER TABLE public\.auth_sessions ENABLE ROW LEVEL SECURITY/i)
  assert.match(migration, /REVOKE ALL ON TABLE public\.auth_sessions FROM PUBLIC, anon, authenticated/i)
})

test("expired session cleanup and the physical contract are continuously attestable", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.cleanup_talon_auth_sessions\(\)/i)
  assert.match(migration, /WHERE expires_at < NOW\(\) - INTERVAL '7 days'/i)
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_talon_session_contract_issues\(\)/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_talon_session_contract_issues\(\) TO service_role/i)
})

test("revocable sessions advance the database contract to v45", () => {
  assert.match(migration, /\(45,\s*'revocable_sessions'\)/i)
  assert.equal(EXPECTED_SCHEMA_VERSION, 45)
})
