import { type NextRequest, NextResponse } from "next/server"
import { addContributorToProjectList } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid, readJsonObject } from "@/lib/validation"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; listId: string }> }
) {
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id, listId } = await params
    const body = await readJsonObject(request)
    const ecosystemId = normalizeUuid(id)
    const projectListId = normalizeUuid(listId)
    const contributorId = normalizeUuid(body?.contributorId)
    if (!body || !ecosystemId || !projectListId || !contributorId) {
      return NextResponse.json({ error: "Missing or invalid project, list, or contributor id" }, { status: 400 })
    }

    await addContributorToProjectList(ecosystemId, projectListId, contributorId, teamId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("Project list not found")) {
      return NextResponse.json({ error: "Project list not found" }, { status: 404 })
    }
    if (error instanceof Error && error.message.includes("Contributor not found")) {
      return NextResponse.json({ error: "Contributor not found" }, { status: 404 })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Contributor is already in this list" }, { status: 409 })
    }
    console.error("[ecosystems/[id]/lists/[listId]/contributors] POST error:", error)
    return NextResponse.json({ error: "Failed to save contributor to list" }, { status: 500 })
  }
}
