import { type NextRequest, NextResponse } from "next/server"
import { getAuthSession, requireAuth } from "@/lib/auth"
import { sessionHasPermission } from "@/lib/permissions"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

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
      return NextResponse.json({
        authenticated: true,
        actor: "user",
        email: team.email,
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
