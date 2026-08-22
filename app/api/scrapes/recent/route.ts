import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { requirePermission } from "@/lib/permissions"
import { getRecentScrapes } from "@/lib/db"
import { logError, logInfo } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

function parsePositiveInteger(value: string | null, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function jsonWithDevMetrics(payload: unknown, requestId: string) {
  if (process.env.NODE_ENV !== "production") {
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8")
    const data = payload as { completed?: unknown[]; failed?: unknown[]; hasMore?: boolean }
    logInfo("scrapes.recent_payload", {
      requestId,
      details: {
        completed: data.completed?.length ?? 0,
        failed: data.failed?.length ?? 0,
        hasMore: Boolean(data.hasMore),
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
    const params = request.nextUrl.searchParams
    const limit = parsePositiveInteger(params.get("limit"), 10)
    const offset = parsePositiveInteger(params.get("offset"), 0)
    const type = params.get("type")
    const payload = await getRecentScrapes({ teamId, limit, offset, type })
    return jsonWithDevMetrics(payload, requestId)
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    logError("scrapes.recent_list_failed", error, { requestId })
    return internalErrorResponse("scrape_list_recent_failed", requestId)
  }
}
