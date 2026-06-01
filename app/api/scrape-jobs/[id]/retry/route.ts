import { type NextRequest, NextResponse } from "next/server"
import { recordAuditEvent } from "@/lib/audit"
import { retryScrapeJob } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { runScrapeWorker } from "@/lib/scrape-worker"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid } from "@/lib/validation"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
    const { id } = await params
    const jobId = normalizeUuid(id)
    if (!jobId) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 })
    }

    const job = await retryScrapeJob(jobId, teamId)
    const workerRun = await runScrapeWorker(1, teamId)
    const workerResult = workerRun.results.find((result) => result.jobId === job.id) ?? null
    const triggered = Boolean(workerResult)
    await recordAuditEvent({
      request,
      action: "scrape.retry",
      outcome: "success",
      teamId,
      metadata: { jobId: job.id, scrapeId: job.scrapeId, teamSlug, workerTriggered: triggered },
    })
    return NextResponse.json({ job, workerTriggered: triggered, workerResult })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[scrape-jobs/retry] POST error:", error)
    if (error instanceof Error && error.message.startsWith("Only failed, canceled, or queued retry")) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to retry scrape job" }, { status: 500 })
  }
}
