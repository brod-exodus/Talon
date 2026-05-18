import "server-only"
import { type AuthRole } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"

export type TeamMembershipContext = {
  email: string
  role: AuthRole
  teamId: string
  teamSlug: string
}

function normalizeMembershipEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function getPrimaryTeamMembershipForEmail(email: string): Promise<TeamMembershipContext | null> {
  const normalizedEmail = normalizeMembershipEmail(email)
  if (!normalizedEmail) return null

  const { data: membership, error } = await supabaseAdmin
    .from("team_memberships")
    .select("team_id, email, role, created_at")
    .eq("email", normalizedEmail)
    .order("created_at", { ascending: true })
    .limit(1)
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
