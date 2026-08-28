import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationPath = new URL("../db/migrations/053_storage_cleanup_retention.sql", import.meta.url)

test("storage cleanup retention removes only old successful path-free evidence", async () => {
  const migration = await readFile(migrationPath, "utf8")

  assert.match(migration, /DELETE FROM public\.storage_cleanup_tasks[\s\S]*status = 'succeeded'/i)
  assert.match(migration, /object_paths = '\[\]'::JSONB/i)
  assert.match(migration, /completed_at < NOW\(\) - INTERVAL '90 days'/i)
  assert.doesNotMatch(migration, /status IN \('succeeded', 'failed'\)/i)
})

test("storage cleanup retention is private, attestable, and advances schema v53", async () => {
  const migration = await readFile(migrationPath, "utf8")

  assert.match(migration, /REVOKE ALL ON FUNCTION public\.cleanup_storage_cleanup_retention\(\)[\s\S]*PUBLIC, anon, authenticated/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.cleanup_storage_cleanup_retention\(\)[\s\S]*service_role/i)
  assert.match(migration, /get_talon_lifecycle_contract_issues[\s\S]*cleanup_storage_cleanup_retention\(\)/i)
  assert.match(migration, /VALUES \(53, 'storage_cleanup_retention'\)/i)
})
