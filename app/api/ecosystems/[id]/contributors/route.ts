import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getOrRecomputeEcosystemContributors } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid } from "@/lib/validation"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(_request)
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(_request)
    const { id } = await params
    const ecosystemId = normalizeUuid(id)
    if (!ecosystemId) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 })
    }
    const cache = await getOrRecomputeEcosystemContributors(ecosystemId, teamId)
    return NextResponse.json(cache)
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[ecosystems/[id]/contributors] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch project contributors" }, { status: 500 })
  }
}
