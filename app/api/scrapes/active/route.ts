import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { requirePermission } from "@/lib/permissions"
import { getActiveScrapes } from "@/lib/db"
import { logError, logInfo } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

function jsonWithDevMetrics(payload: unknown, requestId: string) {
  if (process.env.NODE_ENV !== "production") {
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8")
    const data = payload as { active?: unknown[]; completed?: unknown[]; failed?: unknown[] }
    logInfo("scrapes.active_payload", {
      requestId,
      details: {
        active: data.active?.length ?? 0,
        completed: data.completed?.length ?? 0,
        failed: data.failed?.length ?? 0,
        bytes,
      },
    })
  }
  return NextResponse.json(payload)
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    return jsonWithDevMetrics(await getActiveScrapes(teamId), requestId)
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    logError("scrapes.active_list_failed", error, { requestId })
    return internalErrorResponse("scrape_list_active_failed", requestId)
  }
}
