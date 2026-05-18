import { type NextRequest, NextResponse } from "next/server"
import { getAuthSession, type AuthRole } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { getTeamMembershipForSession } from "@/lib/team-membership"

const DEFAULT_TEAM_SLUG = "default"

let cachedDefaultTeamId: string | null = null

export type TeamContext = {
  teamId: string
  teamSlug: string
  actor: "admin" | "user"
  email?: string
  role?: AuthRole
}

export async function getDefaultTeamId(): Promise<string> {
  if (cachedDefaultTeamId) return cachedDefaultTeamId

  const { data, error } = await supabaseAdmin
    .from("teams")
    .select("id")
    .eq("slug", DEFAULT_TEAM_SLUG)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error("Default team is missing. Apply db/migrations/008_team_foundation.sql.")

  cachedDefaultTeamId = data.id
  return data.id
}

export async function resolveTeamContext(request: NextRequest): Promise<TeamContext> {
  const session = getAuthSession(request)
  if (session?.actor === "user") {
    const membership = await getTeamMembershipForSession(session.email, session.teamId)
    if (!membership) throw new Error("Authenticated user is not a member of this team.")
    return {
      teamId: membership.teamId,
      teamSlug: membership.teamSlug,
      actor: "user",
      email: membership.email,
      role: membership.role,
    }
  }

  return {
    teamId: await getDefaultTeamId(),
    teamSlug: DEFAULT_TEAM_SLUG,
    actor: "admin",
  }
}

export function teamContextError(error: unknown): NextResponse {
  console.error("[team-context] Failed to resolve team:", error)
  if (error instanceof Error && error.message.includes("not a member")) {
    return NextResponse.json({ error: "User is not a member of this team" }, { status: 403 })
  }
  return NextResponse.json({ error: "Failed to resolve team context" }, { status: 500 })
}
