import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getProjectPipelineItems } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const items = await getProjectPipelineItems(teamId)
    return NextResponse.json({ items })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    console.error("[pipeline] GET error:", {
      error,
      message: error instanceof Error ? error.message : String(error),
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
      details: error && typeof error === "object" && "details" in error ? error.details : undefined,
      hint: error && typeof error === "object" && "hint" in error ? error.hint : undefined,
    })
    return NextResponse.json({ error: "Failed to fetch pipeline" }, { status: 500 })
  }
}
