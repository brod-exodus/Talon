import { randomUUID } from "node:crypto"
import {
  cancelScrapeJob,
  claimNextScrapeJob,
  failScrapeJob,
  getScrapeJobForWorker,
  recoverStaleScrapeJobs,
  recordScrapeJobEvent,
  requeueScrapeJob,
  succeedScrapeJob,
} from "@/lib/db"
import { GitHubApiError } from "@/lib/github"
import { runScrapeJob, ScrapeJobCanceledError } from "@/lib/scrape-runner"
import { runBoundedJobSteps } from "@/lib/worker-budget"
import { sanitizeOperationalError } from "@/lib/logger"

export type ScrapeWorkerResult = {
  jobId: string
  scrapeId: string
  teamId: string
  status: "succeeded" | "queued" | "failed" | "canceled"
  steps?: number
  elapsedMs?: number
  error?: string
  originRequestId?: string | null
}

export async function runScrapeWorker(
  maxJobs = 1,
  teamId?: string,
  requestId?: string
): Promise<{ workerId: string; recoveredStaleJobs: number; results: ScrapeWorkerResult[] }> {
  const workerId = `worker-${randomUUID()}`
  const recoveredStaleJobs = await recoverStaleScrapeJobs(undefined, teamId)
  await recordScrapeJobEvent(
    null,
    null,
    "worker_started",
    "Scrape worker invocation started",
    { workerId, recoveredStaleJobs },
    teamId,
    requestId
  )
  const results: ScrapeWorkerResult[] = []

  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNextScrapeJob(workerId, teamId)
    if (!job) break

    try {
      await recordScrapeJobEvent(job.id, job.scrape_id, "started", "Scrape job execution started", {
        workerId,
        type: job.type,
        target: job.target,
        workerRequestId: requestId,
      })
      const execution = await runBoundedJobSteps({
        initialJob: job,
        runStep: runScrapeJob,
        refreshJob: async () => await getScrapeJobForWorker(job.id, workerId),
      })
      const status = execution.completed ? await succeedScrapeJob(job.id) : "queued"
      if (!execution.completed) {
        await recordScrapeJobEvent(
          job.id,
          job.scrape_id,
          "invocation_yielded",
          "Worker invocation yielded before the job completed",
          { workerId, steps: execution.steps, elapsedMs: execution.elapsedMs }
        )
        await requeueScrapeJob(job.id, job.scrape_id)
      }
      results.push({
        jobId: job.id,
        scrapeId: job.scrape_id,
        teamId: job.team_id,
        status,
        steps: execution.steps,
        elapsedMs: execution.elapsedMs,
        originRequestId: job.request_id,
      })
    } catch (error) {
      const message = sanitizeOperationalError(error).message
      if (error instanceof ScrapeJobCanceledError) {
        await cancelScrapeJob(job.id, message)
        results.push({
          jobId: job.id,
          scrapeId: job.scrape_id,
          teamId: job.team_id,
          status: "canceled",
          error: message,
          originRequestId: job.request_id,
        })
        continue
      }
      const status = await failScrapeJob(job, message, {
        retryAfterMs: error instanceof GitHubApiError ? error.retryAfterMs : undefined,
      })
      results.push({
        jobId: job.id,
        scrapeId: job.scrape_id,
        teamId: job.team_id,
        status,
        error: message,
        originRequestId: job.request_id,
      })
    }
  }

  return { workerId, recoveredStaleJobs, results }
}
