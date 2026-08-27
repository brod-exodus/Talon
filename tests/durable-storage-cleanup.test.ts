import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const migration = readFileSync(resolve(import.meta.dirname, "../db/migrations/051_durable_workspace_storage_cleanup.sql"), "utf8")

test("workspace deletion atomically creates private cleanup work", () => {
  const enqueue = migration.indexOf("INSERT INTO public.storage_cleanup_tasks")
  const deleteTeam = migration.indexOf("DELETE FROM public.teams")
  assert.ok(enqueue >= 0 && enqueue < deleteTeam)
  assert.match(migration, /REVOKE ALL ON TABLE public\.storage_cleanup_tasks FROM PUBLIC, anon, authenticated/i)
  assert.match(migration, /RETURN jsonb_build_object\([^;]+hasStorageCleanup/is)
})

test("storage cleanup uses atomic claims, leases, bounded retry, and stale recovery", () => {
  assert.match(migration, /FOR UPDATE SKIP LOCKED/i)
  assert.match(migration, /attempts = task\.attempts \+ 1/i)
  assert.match(migration, /attempts >= max_attempts THEN 'failed'/i)
  assert.match(migration, /locked_by=p_worker_id/i)
  assert.match(migration, /recover_stale_storage_cleanup_tasks/i)
  assert.match(migration, /\(51, 'durable_workspace_storage_cleanup'\)/i)
})
