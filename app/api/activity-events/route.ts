import { type NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/permissions"
import { getRecentActivityEvents } from "@/lib/activity"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

export async function GET(request: NextRequest) {
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "10")
    const events = await getRecentActivityEvents(teamId, Number.isFinite(rawLimit) ? rawLimit : 10)
    return NextResponse.json({ events })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    console.error("[activity-events] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch activity events" }, { status: 500 })
  }
}
