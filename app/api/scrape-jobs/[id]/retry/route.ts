import { after, type NextRequest, NextResponse } from "next/server"
import { recordAuditEvent } from "@/lib/audit"
import { retryScrapeJob } from "@/lib/db"
import { logError, logInfo } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { runScrapeWorkerOperation } from "@/lib/scrape-worker-operation"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid } from "@/lib/validation"

export const maxDuration = 60

function scheduleRetryWorker(teamId: string, teamSlug: string, requestId: string, jobId: string, scrapeId: string) {
  // The one-minute cron remains the durable recovery path if this best-effort
  // post-response dispatch is interrupted or another worker owns the queue.
  after(async () => {
    try {
      await runScrapeWorkerOperation({ trigger: "retry", teamId, teamSlug, requestId })
    } catch (error) {
      logError("scrape.retry_dispatch_failed", error, { requestId, teamId, jobId, scrapeId })
    }
  })
}

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

    const job = await retryScrapeJob(jobId, teamId)
    await recordAuditEvent({
      request,
      action: "scrape.retry",
      outcome: "success",
      teamId,
      metadata: { jobId: job.id, scrapeId: job.scrapeId, teamSlug, workerScheduled: true },
    })
    logInfo("scrape.retry_queued", { requestId, teamId, jobId: job.id, scrapeId: job.scrapeId })
    scheduleRetryWorker(teamId, teamSlug, requestId, job.id, job.scrapeId)
    return NextResponse.json({ job, status: "queued", dispatch: "immediate" }, { status: 202 })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    logError("scrape.retry_failed", error, { requestId })
    if (error instanceof Error && error.message.startsWith("Only failed, canceled, or queued retry")) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to retry scrape job" }, { status: 500 })
  }
}
