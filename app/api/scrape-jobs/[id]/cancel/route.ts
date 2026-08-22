import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { recordAuditEvent } from "@/lib/audit"
import { cancelScrapeJob } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid } from "@/lib/validation"
import { logError } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"

const SUCCEEDED_JOB_CONFLICT = "Succeeded scrape jobs cannot be canceled"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
    const { id } = await params
    const jobId = normalizeUuid(id)
    if (!jobId) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 })
    }

    const job = await cancelScrapeJob(jobId, "Scrape canceled", teamId)
    await recordAuditEvent({
      request,
      action: "scrape.cancel",
      outcome: "success",
      teamId,
      metadata: { jobId: job.id, scrapeId: job.scrapeId, teamSlug },
    })
    return NextResponse.json({ job })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message === SUCCEEDED_JOB_CONFLICT) {
      return NextResponse.json({ error: SUCCEEDED_JOB_CONFLICT }, { status: 409 })
    }
    logError("scrape.cancel_failed", error, { requestId })
    return internalErrorResponse("scrape_job_cancel_failed", requestId)
  }
}
