import { randomUUID } from "node:crypto"
import { cancelScrapeJob, claimNextScrapeJob, failScrapeJob, recordScrapeJobEvent, succeedScrapeJob } from "@/lib/db"
import { GitHubApiError } from "@/lib/github"
import { runScrapeJob, ScrapeJobCanceledError } from "@/lib/scrape-runner"

export type ScrapeWorkerResult = {
  jobId: string
  scrapeId: string
  status: "succeeded" | "queued" | "failed" | "canceled"
  error?: string
}

export async function runScrapeWorker(maxJobs = 1): Promise<{ workerId: string; results: ScrapeWorkerResult[] }> {
  const workerId = `worker-${randomUUID()}`
  await recordScrapeJobEvent(null, null, "worker_started", "Scrape worker invocation started", { workerId })
  const results: ScrapeWorkerResult[] = []

  for (let i = 0; i < maxJobs; i++) {
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

  return { workerId, results }
}
