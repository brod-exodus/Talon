import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const migrationPath = new URL("../db/migrations/052_minimize_completed_storage_cleanup.sql", import.meta.url)

test("successful storage cleanup atomically removes deleted object paths", async () => {
  const migration = await readFile(migrationPath, "utf8")

  assert.match(migration, /UPDATE public\.storage_cleanup_tasks[\s\S]*status = 'succeeded'[\s\S]*object_paths = '\[\]'::JSONB/i)
  assert.match(migration, /WHERE id = p_task_id[\s\S]*status = 'running'[\s\S]*locked_by = p_worker_id/i)
  assert.match(migration, /storage_cleanup_terminal_paths_scrubbed/i)
  assert.match(migration, /pg_namespace\.nspname = 'public'[\s\S]*pg_class\.relname = 'storage_cleanup_tasks'/i)
})

test("migration scrubs existing successes without removing paths needed for retry", async () => {
  const migration = await readFile(migrationPath, "utf8")

  assert.match(migration, /WHERE status = 'succeeded'[\s\S]*object_paths <> '\[\]'::JSONB/i)
  assert.match(migration, /status <> 'succeeded' AND jsonb_array_length\(object_paths\) > 0/i)
  assert.match(migration, /VALUES \(52, 'minimize_completed_storage_cleanup'\)/i)
})
