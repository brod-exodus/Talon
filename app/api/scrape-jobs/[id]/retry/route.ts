import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { retryScrapeJob } from "@/lib/db"
import { runScrapeWorker } from "@/lib/scrape-worker"
import { normalizeUuid } from "@/lib/validation"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { id } = await params
    const jobId = normalizeUuid(id)
    if (!jobId) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 })
    }

    const job = await retryScrapeJob(jobId)
    const workerRun = await runScrapeWorker(1)
    const triggered = workerRun.results.some((result) => result.jobId === job.id)
    return NextResponse.json({ job, workerTriggered: triggered })
  } catch (error) {
    console.error("[scrape-jobs/retry] POST error:", error)
    if (error instanceof Error && error.message.startsWith("Only failed or canceled")) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to retry scrape job" }, { status: 500 })
  }
}
