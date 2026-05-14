import { type NextRequest, NextResponse } from "next/server"
import { hasCronSecret, requireAuth } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { runScrapeWorker } from "@/lib/scrape-worker"

const MAX_JOBS_PER_INVOCATION = 1

export async function POST(request: NextRequest) {
  const isCronRequest = hasCronSecret(request)
  if (!isCronRequest) {
    const authError = requireAuth(request)
    if (authError) return authError
  }

  const { workerId, results } = await runScrapeWorker(MAX_JOBS_PER_INVOCATION)
  const hasFailedResult = results.some((result) => result.status === "failed")
  await recordAuditEvent({
    request,
    action: "scrape_worker.run",
    outcome: hasFailedResult ? "failure" : "success",
    actor: isCronRequest ? "cron" : "admin",
    metadata: {
      workerId,
      processed: results.length,
      statuses: results.map((result) => result.status),
    },
  })
  for (const result of results) {
    if (result.status !== "failed") continue
    await recordAuditEvent({
      request,
      action: "scrape.failure",
      outcome: "failure",
      actor: isCronRequest ? "cron" : "admin",
      metadata: {
        workerId,
        jobId: result.jobId,
        scrapeId: result.scrapeId,
        error: result.error ?? "Unknown scrape job error",
      },
    })
  }

  return NextResponse.json({ workerId, processed: results.length, results })
}
