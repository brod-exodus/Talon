import "server-only"
import { type AuthRole } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import {
  fallbackDisplayName,
  normalizeMembershipEmail,
  privateWorkspaceName,
  privateWorkspaceSlug,
  selectPrimaryTeamMembership,
  type TeamMembershipCandidate,
} from "@/lib/team-membership-selection"

export type TeamMembershipContext = {
  email: string
  role: AuthRole
  teamId: string
  teamSlug: string
}

export async function getPrimaryTeamMembershipForEmail(email: string): Promise<TeamMembershipContext | null> {
  const normalizedEmail = normalizeMembershipEmail(email)
  if (!normalizedEmail) return null

  const { data: memberships, error } = await supabaseAdmin
    .from("team_memberships")
    .select("team_id, email, role, created_at")
    .eq("email", normalizedEmail)
    .order("created_at", { ascending: true })
  if (error) throw error
  if (!memberships?.length) return null

  const teamIds = memberships.map((membership) => membership.team_id)
  const { data: teams, error: teamError } = await supabaseAdmin
    .from("teams")
    .select("id, slug, owner_email, workspace_kind")
    .in("id", teamIds)
  if (teamError) throw teamError

  const teamsById = new Map((teams ?? []).map((team) => [team.id, team]))
  const candidates = memberships.flatMap((membership): TeamMembershipCandidate[] => {
    const team = teamsById.get(membership.team_id)
    if (!team?.slug) return []
    return [{
      email: normalizedEmail,
      role: membership.role as AuthRole,
      teamId: membership.team_id,
      teamSlug: team.slug,
      createdAt: membership.created_at,
      ownerEmail: team.owner_email,
      workspaceKind: team.workspace_kind,
    }]
  })

  const selected = selectPrimaryTeamMembership(candidates, normalizedEmail)
  if (!selected) return null
  return {
    email: selected.email,
    role: selected.role,
    teamId: selected.teamId,
    teamSlug: selected.teamSlug,
  }
}

export async function ensurePrivateWorkspaceForUser(
  email: string,
  displayName?: string | null
): Promise<TeamMembershipContext> {
  const normalizedEmail = normalizeMembershipEmail(email)
  if (!normalizedEmail) throw new Error("Cannot provision private workspace without a valid email.")

  const { data: existingTeam, error: existingTeamError } = await supabaseAdmin
    .from("teams")
    .select("id, slug")
    .eq("workspace_kind", "private")
    .eq("owner_email", normalizedEmail)
    .maybeSingle()
  if (existingTeamError) throw existingTeamError

  let team = existingTeam
  if (!team?.id) {
    const { data: createdTeam, error: createTeamError } = await supabaseAdmin
      .from("teams")
      .insert({
        slug: privateWorkspaceSlug(normalizedEmail),
        name: privateWorkspaceName(normalizedEmail, displayName),
        owner_email: normalizedEmail,
        workspace_kind: "private",
      })
      .select("id, slug")
      .single()
    if (createTeamError) {
      if (createTeamError.code !== "23505") throw createTeamError
      const { data: racedTeam, error: racedTeamError } = await supabaseAdmin
        .from("teams")
        .select("id, slug")
        .eq("workspace_kind", "private")
        .eq("owner_email", normalizedEmail)
        .maybeSingle()
      if (racedTeamError) throw racedTeamError
      team = racedTeam
    } else {
      team = createdTeam
    }
  }

  if (!team?.id || !team.slug) throw new Error("Private workspace could not be provisioned.")

  const { error: membershipError } = await supabaseAdmin
    .from("team_memberships")
    .upsert(
      {
        team_id: team.id,
        email: normalizedEmail,
        display_name: displayName?.trim() || fallbackDisplayName(normalizedEmail),
        role: "owner",
        invited_by: null,
      },
      { onConflict: "team_id,email" }
    )
  if (membershipError) throw membershipError

  return {
    email: normalizedEmail,
    role: "owner",
    teamId: team.id,
    teamSlug: team.slug,
  }
}

export async function getTeamMembershipForSession(
  email: string,
  teamId: string
): Promise<TeamMembershipContext | null> {
  const normalizedEmail = normalizeMembershipEmail(email)
  if (!normalizedEmail) return null

  const { data: membership, error } = await supabaseAdmin
    .from("team_memberships")
    .select("team_id, email, role")
    .eq("email", normalizedEmail)
    .eq("team_id", teamId)
    .maybeSingle()
  if (error) throw error
  if (!membership?.team_id) return null

  const { data: team, error: teamError } = await supabaseAdmin
    .from("teams")
    .select("slug")
    .eq("id", membership.team_id)
    .maybeSingle()
  if (teamError) throw teamError
  if (!team?.slug) return null

  return {
    email: normalizedEmail,
    role: membership.role as AuthRole,
    teamId: membership.team_id,
    teamSlug: team.slug,
  }
}
