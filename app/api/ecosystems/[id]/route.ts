import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getEcosystem, deleteEcosystem } from "@/lib/db"
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
    const ecosystem = await getEcosystem(ecosystemId, teamId)
    if (!ecosystem) {
      return NextResponse.json({ error: "Ecosystem not found" }, { status: 404 })
    }
    return NextResponse.json({ ecosystem })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[ecosystems/[id]] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch ecosystem" }, { status: 500 })
  }
}

export async function DELETE(
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
    await deleteEcosystem(ecosystemId, teamId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[ecosystems/[id]] DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete ecosystem" }, { status: 500 })
  }
}
