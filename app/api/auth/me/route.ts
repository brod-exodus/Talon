import { type NextRequest, NextResponse } from "next/server"
import { getAuthSession, requireAuth } from "@/lib/auth"
import { sessionHasPermission } from "@/lib/permissions"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

type UserProfileFields = {
  display_name: string | null
  avatar_url: string | null
}

async function getUserProfileFields(teamId: string, email: string): Promise<UserProfileFields | null> {
  const { data, error } = await supabaseAdmin
    .from("team_memberships")
    .select("display_name, avatar_url")
    .eq("team_id", teamId)
    .eq("email", email)
    .maybeSingle()

  if (error) {
    if (error.code === "42703") {
      console.warn("[auth/me] Profile columns are missing. Apply db/migrations/012_team_profile_photos.sql.")
      return null
    }
    throw error
  }

  return (data as UserProfileFields | null) ?? null
}

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const session = getAuthSession(request)
    const team = await resolveTeamContext(request)
    const permissions = {
      canRead: sessionHasPermission(session, "read"),
      canWrite: sessionHasPermission(session, "write"),
      canAdmin: sessionHasPermission(session, "admin"),
    }

    if (team.actor === "user") {
      if (!team.email) throw new Error("Authenticated user is missing an email.")
      const profile = await getUserProfileFields(team.teamId, team.email)
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
    return teamContextError(error)
  }
}
