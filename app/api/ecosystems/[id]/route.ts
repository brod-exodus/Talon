import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { getEcosystem, deleteEcosystem } from "@/lib/db"
import { logError } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid } from "@/lib/validation"

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
    if (!ecosystemId) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 })
    }
    const ecosystem = await getEcosystem(ecosystemId, teamId)
    if (!ecosystem) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    return NextResponse.json({ ecosystem })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    logError("ecosystem.read_failed", error, { requestId })
    return internalErrorResponse("ecosystem_read_failed", requestId)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id } = await params
    const ecosystemId = normalizeUuid(id)
    if (!ecosystemId) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 })
    }
    await deleteEcosystem(ecosystemId, teamId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    logError("ecosystem.delete_failed", error, { requestId })
    return internalErrorResponse("ecosystem_delete_failed", requestId)
  }
}
