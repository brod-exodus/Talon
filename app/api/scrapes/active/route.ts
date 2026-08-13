import { type NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/permissions"
import { getActiveScrapes } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

function jsonWithDevMetrics(payload: unknown) {
  if (process.env.NODE_ENV !== "production") {
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8")
    const data = payload as { active?: unknown[]; completed?: unknown[]; failed?: unknown[] }
    console.info("[dashboard-scrapes] active", {
      active: data.active?.length ?? 0,
      completed: data.completed?.length ?? 0,
      failed: data.failed?.length ?? 0,
      bytes,
    })
  }
  return NextResponse.json(payload)
}

export async function GET(request: NextRequest) {
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    return jsonWithDevMetrics(await getActiveScrapes(teamId))
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[dashboard-scrapes] Failed to fetch active scrapes:", error)
    return NextResponse.json({ error: "Failed to fetch active scrapes", active: [], completed: [], failed: [] }, { status: 500 })
  }
}
