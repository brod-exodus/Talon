import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { requirePermission } from "@/lib/permissions"
import { getDueProjectFollowUps } from "@/lib/db"
import { logError } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const followUps = await getDueProjectFollowUps(teamId)
    return NextResponse.json({ followUps })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error, requestId)
    logError("follow_ups.list_failed", error, { requestId })
    return internalErrorResponse("follow_up_list_failed", requestId)
  }
}
