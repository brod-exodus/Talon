import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { createProjectList, getProjectLists } from "@/lib/db"
import { logError } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeName, normalizeUuid, readJsonObject } from "@/lib/validation"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id } = await params
    const ecosystemId = normalizeUuid(id)
    if (!ecosystemId) return NextResponse.json({ error: "Invalid project id" }, { status: 400 })

    const includeContributorIds = request.nextUrl.searchParams.get("includeContributorIds") === "1"
    const lists = await getProjectLists(ecosystemId, teamId, { includeContributorIds })
    return NextResponse.json({ lists })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message.includes("Project not found")) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    logError("ecosystem_lists.read_failed", error, { requestId })
    return internalErrorResponse("ecosystem_list_read_failed", requestId)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
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
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message.includes("Project not found")) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A list with that name already exists in this Project" }, { status: 409 })
    }
    logError("ecosystem_lists.create_failed", error, { requestId })
    return internalErrorResponse("ecosystem_list_create_failed", requestId)
  }
}
