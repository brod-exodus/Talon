import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/050_transactional_workspace_deletion.sql"),
  "utf8"
)

test("workspace deletion is one service-role-only database transaction", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.delete_workspace_data\(/i)
  assert.match(migration, /FOR UPDATE/i)
  assert.match(migration, /DELETE FROM public\.teams WHERE id = p_team_id/i)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.delete_workspace_data\(UUID, TEXT\) FROM PUBLIC, anon, authenticated/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.delete_workspace_data\(UUID, TEXT\) TO service_role/i)
})

test("workspace deletion fails closed around confirmation and active work", () => {
  assert.match(migration, /p_confirmation IS DISTINCT FROM workspace\.slug/i)
  assert.match(migration, /status IN \('queued', 'running'\)/i)
  assert.match(migration, /RAISE EXCEPTION 'Workspace has active work' USING ERRCODE = '55006'/i)
})

test("workspace deletion removes scoped audit history and keeps an anonymous receipt", () => {
  const deleteHistory = migration.indexOf("DELETE FROM public.audit_events WHERE team_id = p_team_id")
  const deleteTeam = migration.indexOf("DELETE FROM public.teams WHERE id = p_team_id")
  const receipt = migration.indexOf("'workspace.delete'")
  assert.ok(deleteHistory >= 0 && deleteHistory < deleteTeam && deleteTeam < receipt)
  assert.doesNotMatch(migration.slice(receipt), /workspace\.slug|p_team_id/)
  assert.match(migration, /\(50, 'transactional_workspace_deletion'\)/i)
})
