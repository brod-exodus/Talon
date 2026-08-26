import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { EXPECTED_SCHEMA_VERSION } from "../lib/schema-version.ts"
import {
  MAX_IMMEDIATE_WORKSPACE_EXPORT_BYTES,
  normalizeWorkspaceExport,
  serializeWorkspaceExport,
} from "../lib/workspace-export.ts"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/049_workspace_data_export.sql"),
  "utf8"
)

const dataKeys = [
  "members", "contributors", "scrapes", "scrapeContributors", "projects",
  "projectScrapes", "projectLists", "projectListContributors", "projectTracking",
  "sharedLinks", "watchedRepositories", "watchedContributors",
]

function emptyExport() {
  return {
    format: "talon-workspace-export",
    version: 1,
    generatedAt: "2026-08-25T12:00:00.000Z",
    workspace: { name: "Recruiting", kind: "private", teamId: "must-not-escape" },
    data: Object.fromEntries(dataKeys.map((key) => [key, []])),
    tokenHash: "must-not-escape",
  }
}

test("workspace export is a stable service-role-only database snapshot", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.export_workspace_data\(p_team_id UUID\)/i)
  assert.match(migration, /RETURNS JSONB[\s\S]+STABLE[\s\S]+SECURITY DEFINER/i)
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.export_workspace_data\(UUID\) FROM PUBLIC, anon, authenticated/i)
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.export_workspace_data\(UUID\) TO service_role/i)
  assert.doesNotMatch(migration, /'tokenHash'|'token_hash'|'teamId'|'team_id'/i)
  assert.doesNotMatch(migration, /DELETE FROM/i)
})

test("workspace export covers recruiter-owned relationships and advances schema v49", () => {
  for (const table of [
    "team_memberships", "contributors", "scrapes", "scrape_contributors", "ecosystems",
    "ecosystem_scrapes", "project_lists", "project_list_contributors",
    "project_contributor_tracking", "shared_scrapes", "watched_repos",
    "watched_repo_contributors",
  ]) {
    assert.match(migration, new RegExp(`FROM public\\.${table}[^;]+team_id = p_team_id`, "i"), table)
  }
  assert.match(migration, /\(49, 'workspace_data_export'\)/i)
  assert.equal(EXPECTED_SCHEMA_VERSION, 49)
})

test("normalization strips unexpected database fields and pins exclusions", () => {
  const normalized = normalizeWorkspaceExport({
    ...emptyExport(),
    data: {
      ...emptyExport().data,
      contributors: [{
        id: "contributor-1", githubUsername: "octocat", name: null, avatarUrl: null,
        bio: null, location: null, company: null, email: "octocat@example.com",
        twitter: null, linkedin: null, website: null, contacted: false,
        contactedDate: null, outreachNotes: "private", outreachNotesUpdatedAt: null,
        status: null, reminderNote: null, reminderDate: null, reminderUpdatedAt: null,
        createdAt: "2026-08-25T12:00:00Z", updatedAt: "2026-08-25T12:00:00Z",
        tokenHash: "must-not-escape", teamId: "must-not-escape",
      }],
    },
  })
  const serialized = JSON.stringify(normalized)
  assert.match(serialized, /octocat@example\.com/)
  assert.doesNotMatch(serialized, /must-not-escape|tokenHash|teamId/)
  assert.deepEqual(normalized.excluded, [
    "supabase_auth", "profile_photo_storage", "operational_history", "auth_sessions",
    "derived_caches", "encrypted_backups", "secrets",
  ])
})

test("serialization produces a bounded, newline-terminated JSON document", () => {
  const exported = serializeWorkspaceExport(emptyExport())
  assert.equal(exported.body.endsWith("\n"), true)
  assert.equal(exported.bytes, new TextEncoder().encode(exported.body).byteLength)
  assert.equal(MAX_IMMEDIATE_WORKSPACE_EXPORT_BYTES, 4 * 1024 * 1024)
})
