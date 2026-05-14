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
  await recordAuditEvent({
    request,
    action: "scrape_worker.run",
    outcome: "success",
    actor: isCronRequest ? "cron" : "admin",
    metadata: {
      workerId,
      processed: results.length,
      statuses: results.map((result) => result.status),
    },
  })

  return NextResponse.json({ workerId, processed: results.length, results })
}
