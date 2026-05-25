import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createProjectList, getProjectLists } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeName, normalizeUuid, readJsonObject } from "@/lib/validation"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id } = await params
    const ecosystemId = normalizeUuid(id)
    if (!ecosystemId) return NextResponse.json({ error: "Invalid project id" }, { status: 400 })

    const lists = await getProjectLists(ecosystemId, teamId)
    return NextResponse.json({ lists })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("Project not found")) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    console.error("[ecosystems/[id]/lists] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch project lists" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id } = await params
    const body = await readJsonObject(request)
    const ecosystemId = normalizeUuid(id)
    const name = normalizeName(body?.name)
    if (!body || !ecosystemId || !name) {
      return NextResponse.json({ error: "Missing or invalid project id or name" }, { status: 400 })
    }

    const list = await createProjectList(ecosystemId, name, teamId)
    return NextResponse.json({ list })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("Project not found")) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A list with that name already exists in this Project" }, { status: 409 })
    }
    console.error("[ecosystems/[id]/lists] POST error:", error)
    return NextResponse.json({ error: "Failed to create project list" }, { status: 500 })
  }
}
