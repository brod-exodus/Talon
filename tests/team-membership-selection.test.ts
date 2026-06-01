import test from "node:test"
import assert from "node:assert/strict"
import {
  privateWorkspaceName,
  privateWorkspaceSlug,
  selectPrimaryTeamMembership,
  type TeamMembershipCandidate,
} from "../lib/team-membership-selection.ts"

const memberships: TeamMembershipCandidate[] = [
  {
    email: "user@example.com",
    role: "viewer",
    teamId: "shared-team",
    teamSlug: "default",
    createdAt: "2026-01-01T00:00:00.000Z",
    workspaceKind: "shared",
    ownerEmail: null,
  },
  {
    email: "user@example.com",
    role: "owner",
    teamId: "private-team",
    teamSlug: "user-private",
    createdAt: "2026-02-01T00:00:00.000Z",
    workspaceKind: "private",
    ownerEmail: "USER@example.com",
  },
]

test("selectPrimaryTeamMembership prefers the user's private workspace", () => {
  assert.equal(selectPrimaryTeamMembership(memberships, "user@example.com")?.teamId, "private-team")
})

test("selectPrimaryTeamMembership falls back to oldest membership when no private workspace exists", () => {
  const sharedOnly = memberships.filter((membership) => membership.workspaceKind !== "private")

  assert.equal(
    selectPrimaryTeamMembership(sharedOnly, "user@example.com")?.teamId,
    "shared-team"
  )
})

test("private workspace naming and slugs are stable and account-scoped", () => {
  assert.equal(privateWorkspaceName("brody@example.com", "Brody"), "Brody's Workspace")
  assert.equal(privateWorkspaceName("brody@example.com"), "brody's Workspace")
  assert.equal(privateWorkspaceSlug("Brody@Example.com"), privateWorkspaceSlug("brody@example.com"))
  assert.match(privateWorkspaceSlug("brody@example.com"), /^user-[a-f0-9]{16}$/)
})
