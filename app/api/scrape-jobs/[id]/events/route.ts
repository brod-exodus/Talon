import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { getScrapeJobTimeline } from "@/lib/db"
import { logError } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid } from "@/lib/validation"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "admin")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id } = await params
    const jobId = normalizeUuid(id)
    if (!jobId) return NextResponse.json({ error: "Invalid job id" }, { status: 400 })

    const events = await getScrapeJobTimeline(jobId, 100, teamId)
    if (!events) return NextResponse.json({ error: "Scrape job not found" }, { status: 404 })
    return NextResponse.json({ events }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) {
      return teamContextError(error, requestId)
    }
    logError("scrape_job_timeline.read_failed", error, { requestId })
    return internalErrorResponse("scrape_job_timeline_failed", requestId)
  }
}
