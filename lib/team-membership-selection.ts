import { createHash } from "node:crypto"
import { type AuthRole } from "./auth-token.ts"

export type TeamMembershipCandidate = {
  email: string
  role: AuthRole
  teamId: string
  teamSlug: string
  createdAt: string
  ownerEmail?: string | null
  workspaceKind?: string | null
}

export function normalizeMembershipEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function fallbackDisplayName(email: string): string {
  return email.split("@")[0] || "My"
}

export function privateWorkspaceName(email: string, displayName?: string | null): string {
  const name = displayName?.trim().replace(/\s+/g, " ") || fallbackDisplayName(email)
  return name === "My" ? "My Workspace" : `${name}'s Workspace`
}

export function privateWorkspaceSlug(email: string): string {
  return `user-${createHash("sha256").update(normalizeMembershipEmail(email)).digest("hex").slice(0, 16)}`
}

export function selectPrimaryTeamMembership(
  memberships: TeamMembershipCandidate[],
  email: string
): TeamMembershipCandidate | null {
  const normalizedEmail = normalizeMembershipEmail(email)
  const sorted = [...memberships].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  const privateMembership = sorted.find(
    (membership) =>
      membership.workspaceKind === "private" &&
      membership.ownerEmail?.trim().toLowerCase() === normalizedEmail
  )
  return privateMembership ?? sorted[0] ?? null
}
