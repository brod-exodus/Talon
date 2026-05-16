import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { retryScrapeJob } from "@/lib/db"
import { runScrapeWorker } from "@/lib/scrape-worker"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid } from "@/lib/validation"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAuth(request)
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
    const triggered = workerRun.results.some((result) => result.jobId === job.id)
    await recordAuditEvent({
      request,
      action: "scrape.retry",
      outcome: "success",
      metadata: { jobId: job.id, scrapeId: job.scrapeId, teamSlug, workerTriggered: triggered },
    })
    return NextResponse.json({ job, workerTriggered: triggered })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[scrape-jobs/retry] POST error:", error)
    if (error instanceof Error && error.message.startsWith("Only failed, canceled, or queued retry")) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to retry scrape job" }, { status: 500 })
  }
}
