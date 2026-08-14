import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "..")
const migration = readFileSync(
  resolve(repositoryRoot, "db/migrations/040_atomic_team_member_management.sql"),
  "utf8"
)
const route = readFileSync(resolve(repositoryRoot, "app/api/team-members/[id]/route.ts"), "utf8")

test("team member mutations serialize on the parent team before owner counting", () => {
  const parentLocks = migration.match(/FROM public\.teams AS team[\s\S]*?FOR UPDATE;/gi) ?? []
  assert.equal(parentLocks.length, 2)
  assert.match(migration, /COALESCE\(target_member\.app_role, target_member\.role\) = 'owner'/i)
  assert.match(migration, /COUNT\(\*\)[\s\S]+COALESCE\(membership\.app_role, membership\.role\) = 'owner'/i)
  assert.match(migration, /RAISE EXCEPTION 'At least one owner must remain on the team'/i)
})

test("role changes and removals use the atomic database functions", () => {
  assert.match(route, /\.rpc\("update_team_member_app_role"/)
  assert.match(route, /\.rpc\("remove_team_member"/)
  assert.doesNotMatch(route, /\.from\("team_memberships"\)[\s\S]+\.(update|delete)\(/)
  assert.match(route, /status: 409/)
})

test("team member mutation functions are service-role only and record schema v40", () => {
  for (const signature of [
    "update_team_member_app_role\\(UUID, UUID, TEXT\\)",
    "remove_team_member\\(UUID, UUID\\)",
  ]) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature} FROM PUBLIC`, "i"))
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role`, "i"))
  }
  assert.match(migration, /\(40,\s*'atomic_team_member_management'\)/i)
})
