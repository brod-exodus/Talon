import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getRecentScrapes } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

function parsePositiveInteger(value: string | null, fallback: number) {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function jsonWithDevMetrics(payload: unknown) {
  if (process.env.NODE_ENV !== "production") {
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8")
    const data = payload as { completed?: unknown[]; failed?: unknown[]; hasMore?: boolean }
    console.info("[dashboard-scrapes] recent", {
      completed: data.completed?.length ?? 0,
      failed: data.failed?.length ?? 0,
      hasMore: Boolean(data.hasMore),
      bytes,
    })
  }
  return NextResponse.json(payload)
}

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const params = request.nextUrl.searchParams
    const limit = parsePositiveInteger(params.get("limit"), 10)
    const offset = parsePositiveInteger(params.get("offset"), 0)
    const type = params.get("type")
    const payload = await getRecentScrapes({ teamId, limit, offset, type })
    return jsonWithDevMetrics(payload)
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[dashboard-scrapes] Failed to fetch recent scrapes:", error)
    return NextResponse.json(
      { error: "Failed to fetch recent scrapes", completed: [], failed: [], hasMore: false, nextOffset: 0 },
      { status: 500 },
    )
  }
}
