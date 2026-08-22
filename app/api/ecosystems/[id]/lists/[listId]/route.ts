import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { deleteProjectList, renameProjectList } from "@/lib/db"
import { logError } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeName, normalizeUuid, readJsonObject } from "@/lib/validation"

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; listId: string }> }
) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id, listId } = await params
    const body = await readJsonObject(request)
    const ecosystemId = normalizeUuid(id)
    const projectListId = normalizeUuid(listId)
    const name = normalizeName(body?.name)
    if (!body || !ecosystemId || !projectListId || !name) {
      return NextResponse.json({ error: "Missing or invalid project, list, or name" }, { status: 400 })
    }

    const list = await renameProjectList(ecosystemId, projectListId, name, teamId)
    return NextResponse.json({ list })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message.includes("Project list not found")) {
      return NextResponse.json({ error: "Project list not found" }, { status: 404 })
    }
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A list with that name already exists in this Project" }, { status: 409 })
    }
    logError("ecosystem_lists.update_failed", error, { requestId })
    return internalErrorResponse("ecosystem_list_update_failed", requestId)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; listId: string }> }
) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id, listId } = await params
    const ecosystemId = normalizeUuid(id)
    const projectListId = normalizeUuid(listId)
    if (!ecosystemId || !projectListId) {
      return NextResponse.json({ error: "Missing or invalid project or list id" }, { status: 400 })
    }

    await deleteProjectList(ecosystemId, projectListId, teamId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error, requestId)
    logError("ecosystem_lists.delete_failed", error, { requestId })
    return internalErrorResponse("ecosystem_list_delete_failed", requestId)
  }
}
