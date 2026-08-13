import { type NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/permissions"
import { getProjectPipelinePage, type PipelineDueFilter } from "@/lib/db"
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

function jsonWithDevMetrics(startedAt: number, filters: Record<string, unknown>, payload: unknown) {
  if (process.env.NODE_ENV !== "production") {
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8")
    const data = payload as { items?: unknown[]; total?: number; hasMore?: boolean }
    console.info("[pipeline] page", {
      returned: data.items?.length ?? 0,
      total: data.total ?? 0,
      hasMore: Boolean(data.hasMore),
      filters,
      bytes,
      durationMs: Math.round(performance.now() - startedAt),
    })
  }
  return NextResponse.json(payload)
}

export async function GET(request: NextRequest) {
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
    return jsonWithDevMetrics(startedAt, filters, page)
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    console.error("[pipeline] GET error:", {
      error,
      message: error instanceof Error ? error.message : String(error),
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
      details: error && typeof error === "object" && "details" in error ? error.details : undefined,
      hint: error && typeof error === "object" && "hint" in error ? error.hint : undefined,
    })
    return NextResponse.json({ error: "Failed to fetch pipeline" }, { status: 500 })
  }
}
