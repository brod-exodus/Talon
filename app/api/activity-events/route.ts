import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { requirePermission } from "@/lib/permissions"
import { getRecentActivityEvents } from "@/lib/activity"
import { logError } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "10")
    const events = await getRecentActivityEvents(teamId, Number.isFinite(rawLimit) ? rawLimit : 10)
    return NextResponse.json({ events })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error, requestId)
    logError("activity.list_failed", error, { requestId })
    return internalErrorResponse("activity_list_failed", requestId)
  }
}
