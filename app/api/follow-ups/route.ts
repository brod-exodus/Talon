import { type NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/permissions"
import { getDueProjectFollowUps } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

export async function GET(request: NextRequest) {
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const followUps = await getDueProjectFollowUps(teamId)
    return NextResponse.json({ followUps })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    console.error("[follow-ups] GET error:", {
      error,
      message: error instanceof Error ? error.message : String(error),
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
      details: error && typeof error === "object" && "details" in error ? error.details : undefined,
      hint: error && typeof error === "object" && "hint" in error ? error.hint : undefined,
    })
    return NextResponse.json({ error: "Failed to fetch follow-ups" }, { status: 500 })
  }
}
