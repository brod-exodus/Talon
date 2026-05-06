import { randomUUID } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { hasCronSecret, requireAuth } from "@/lib/auth"
import { cancelScrapeJob, claimNextScrapeJob, failScrapeJob, recordScrapeJobEvent, succeedScrapeJob } from "@/lib/db"
import { GitHubApiError } from "@/lib/github"
import { runScrapeJob, ScrapeJobCanceledError } from "@/lib/scrape-runner"

const MAX_JOBS_PER_INVOCATION = 1

export async function POST(request: NextRequest) {
  if (!hasCronSecret(request)) {
    const authError = requireAuth(request)
    if (authError) return authError
  }

  const workerId = `worker-${randomUUID()}`
  await recordScrapeJobEvent(null, null, "worker_started", "Scrape worker invocation started", { workerId })
  const results: Array<{
    jobId: string
    scrapeId: string
    status: "succeeded" | "queued" | "failed" | "canceled"
    error?: string
  }> = []

  for (let i = 0; i < MAX_JOBS_PER_INVOCATION; i++) {
    const job = await claimNextScrapeJob(workerId)
    if (!job) break

    try {
      await recordScrapeJobEvent(job.id, job.scrape_id, "started", "Scrape job execution started", {
        workerId,
        type: job.type,
        target: job.target,
      })
      await runScrapeJob(job)
      const status = await succeedScrapeJob(job.id)
      results.push({ jobId: job.id, scrapeId: job.scrape_id, status })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown scrape job error"
      if (error instanceof ScrapeJobCanceledError) {
        await cancelScrapeJob(job.id, message)
        results.push({ jobId: job.id, scrapeId: job.scrape_id, status: "canceled", error: message })
        continue
      }
      const status = await failScrapeJob(job, message, {
        retryAfterMs: error instanceof GitHubApiError ? error.retryAfterMs : undefined,
      })
      results.push({ jobId: job.id, scrapeId: job.scrape_id, status, error: message })
    }
  }

  return NextResponse.json({ workerId, processed: results.length, results })
}
