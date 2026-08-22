import { type NextRequest, NextResponse } from "next/server"
import { logWarn } from "@/lib/logger"
import { requirePermission, roleHasPermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

type UserProfileFields = {
  display_name: string | null
  avatar_url: string | null
}

async function getUserProfileFields(
  teamId: string,
  email: string,
  requestId: string
): Promise<UserProfileFields | null> {
  const { data, error } = await supabaseAdmin
    .from("team_memberships")
    .select("display_name, avatar_url")
    .eq("team_id", teamId)
    .eq("email", email)
    .maybeSingle()

  if (error) {
    if (error.code === "42703") {
      logWarn("auth.profile_columns_missing", { requestId, teamId })
      return null
    }
    throw error
  }

  return (data as UserProfileFields | null) ?? null
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const team = await resolveTeamContext(request)
    const permissions = team.actor === "admin"
      ? { canRead: true, canWrite: true, canAdmin: true, canManageMembers: true }
      : (() => {
          if (!team.role) throw new Error("Authenticated user is missing a role.")
          return {
            canRead: roleHasPermission(team.role, "read"),
            canWrite: roleHasPermission(team.role, "write"),
            canAdmin: roleHasPermission(team.role, "admin"),
            canManageMembers: roleHasPermission(team.role, "manage_members"),
          }
        })()

    if (team.actor === "user") {
      if (!team.email) throw new Error("Authenticated user is missing an email.")
      const profile = await getUserProfileFields(team.teamId, team.email, requestId)
      return NextResponse.json({
        authenticated: true,
        actor: "user",
        email: team.email,
        displayName: profile?.display_name ?? null,
        avatarUrl: profile?.avatar_url ?? null,
        teamSlug: team.teamSlug,
        role: team.role,
        permissions,
      })
    }

    return NextResponse.json({
      authenticated: true,
      actor: "admin",
      permissions,
    })
  } catch (error) {
    return teamContextError(error, requestId)
  }
}
