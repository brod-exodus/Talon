import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { requirePermission } from "@/lib/permissions"
import { getProjectPipelinePage, type PipelineDueFilter } from "@/lib/db"
import { logError, logInfo } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import type { ProjectOutreachStatus } from "@/lib/validation"

function parseInteger(value: string | null, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseStatus(value: string | null): ProjectOutreachStatus | "all" {
  const allowed = new Set(["not_contacted", "contacted", "replied", "interested", "interviewing", "rejected", "archived"])
  return value && allowed.has(value) ? (value as ProjectOutreachStatus) : "all"
}

function parseDue(value: string | null): PipelineDueFilter {
  const allowed = new Set(["all", "due", "overdue", "today", "upcoming", "none"])
  return value && allowed.has(value) ? (value as PipelineDueFilter) : "all"
}

function jsonWithDevMetrics(requestId: string, startedAt: number, payload: unknown) {
  if (process.env.NODE_ENV !== "production") {
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8")
    const data = payload as { items?: unknown[]; total?: number; hasMore?: boolean }
    logInfo("pipeline.page", {
      requestId,
      details: {
      returned: data.items?.length ?? 0,
      total: data.total ?? 0,
      hasMore: Boolean(data.hasMore),
      bytes,
      durationMs: Math.round(performance.now() - startedAt),
      },
    })
  }
  return NextResponse.json(payload)
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  const startedAt = performance.now()
  try {
    const { teamId } = await resolveTeamContext(request)
    const params = request.nextUrl.searchParams
    const filters = {
      limit: parseInteger(params.get("limit"), 50),
      offset: parseInteger(params.get("offset"), 0),
      projectId: params.get("project") || "all",
      status: parseStatus(params.get("status")),
      due: parseDue(params.get("due")),
      search: params.get("search") || "",
    }
    const page = await getProjectPipelinePage({ teamId, ...filters })
    return jsonWithDevMetrics(requestId, startedAt, page)
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error, requestId)
    logError("pipeline.read_failed", error, { requestId })
    return internalErrorResponse("pipeline_read_failed", requestId)
  }
}
