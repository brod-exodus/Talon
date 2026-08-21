import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { requireWorkspaceId } from "../lib/workspace-scope.ts"

test("service-role database access rejects missing workspace context", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.throws(
      () => requireWorkspaceId(value),
      /Database operation requires explicit workspace context/
    )
  }
})

test("service-role database access preserves explicit workspace context", () => {
  assert.equal(requireWorkspaceId("  team-123  "), "team-123")
})

test("database helpers never silently substitute the default workspace", () => {
  const databaseSource = readFileSync(resolve(import.meta.dirname, "../lib/db.ts"), "utf8")

  assert.doesNotMatch(databaseSource, /getDefaultTeamId/)
  assert.match(databaseSource, /return requireWorkspaceId\(teamId\)/)
  assert.match(databaseSource, /const teamId = requireWorkspaceId\(profile\.team_id\)/)
  assert.match(databaseSource, /resolvedTeamId = requireWorkspaceId\(resolvedTeamId\)/)
})
