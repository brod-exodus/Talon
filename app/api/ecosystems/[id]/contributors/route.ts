import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getEcosystemContributorPage } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid } from "@/lib/validation"
import type { ProjectOutreachStatus } from "@/lib/validation"

function parseInteger(value: string | null, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function parseList(value: string | null) {
  return value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function parseStatus(value: string | null): ProjectOutreachStatus | "all" {
  const allowed = new Set([
    "not_contacted",
    "contacted",
    "replied",
    "interested",
    "interviewing",
    "rejected",
    "archived",
  ])
  return value && allowed.has(value) ? (value as ProjectOutreachStatus) : "all"
}

function jsonWithDevMetrics(projectId: string, startedAt: number, payload: unknown) {
  if (process.env.NODE_ENV !== "production") {
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8")
    const data = payload as { contributors?: unknown[]; total?: number; cacheStatus?: string }
    console.info("[project-contributors] page", {
      projectId,
      returned: data.contributors?.length ?? 0,
      total: data.total ?? 0,
      cacheStatus: data.cacheStatus,
      bytes,
      durationMs: Math.round(performance.now() - startedAt),
    })
  }
  return NextResponse.json(payload)
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(request)
  if (authError) return authError

  const startedAt = performance.now()
  try {
    const { teamId } = await resolveTeamContext(request)
    const { id } = await params
    const ecosystemId = normalizeUuid(id)
    if (!ecosystemId) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 })
    }

    const searchParams = request.nextUrl.searchParams
    const payload = await getEcosystemContributorPage({
      ecosystemId,
      teamId,
      limit: parseInteger(searchParams.get("limit"), 50),
      offset: parseInteger(searchParams.get("offset"), 0),
      search: searchParams.get("search"),
      minRepos: parseInteger(searchParams.get("minRepos"), 1),
      contactFilters: parseList(searchParams.get("contacts")),
      status: parseStatus(searchParams.get("status")),
      listId: searchParams.get("listId") || "all",
    })
    return jsonWithDevMetrics(ecosystemId, startedAt, payload)
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[ecosystems/[id]/contributors] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch project contributors" }, { status: 500 })
  }
}
