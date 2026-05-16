import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getEcosystemContributors } from "@/lib/db"
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
      return NextResponse.json({ error: "Invalid ecosystem id" }, { status: 400 })
    }
    const contributors = await getEcosystemContributors(ecosystemId, teamId)
    return NextResponse.json({ contributors })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[ecosystems/[id]/contributors] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch ecosystem contributors" }, { status: 500 })
  }
}
