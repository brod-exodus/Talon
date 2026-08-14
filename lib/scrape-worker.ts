import { randomUUID } from "node:crypto"
import {
  cancelScrapeJob,
  claimNextScrapeJob,
  failScrapeJob,
  getScrapeJobForWorker,
  recoverStaleScrapeJobs,
  recordScrapeJobEvent,
  requeueScrapeJob,
} from "@/lib/db"
import { GitHubApiError } from "@/lib/github"
import { runScrapeJob, ScrapeJobCanceledError, ScrapeJobLeaseLostError } from "@/lib/scrape-runner"
import {
  MAX_JOBS_PER_WORKER_INVOCATION,
  MAX_JOB_STEPS_PER_INVOCATION,
  MIN_JOB_START_BUDGET_MS,
  runBoundedJobSteps,
  WORKER_EXECUTION_BUDGET_MS,
} from "@/lib/worker-budget"
import { sanitizeOperationalError } from "@/lib/logger"

export type ScrapeWorkerResult = {
  jobId: string
  scrapeId: string
  teamId: string
  status: "succeeded" | "queued" | "failed" | "canceled" | "skipped"
  steps?: number
  elapsedMs?: number
  error?: string
  originRequestId?: string | null
}

export type ScrapeWorkerStopReason =
  | "queue_empty"
  | "job_limit"
  | "time_budget"
  | "step_budget"
  | "job_yielded"
  | "job_error"

type RunScrapeWorkerOptions = {
  maxJobs?: number
  teamId?: string
  requestId?: string
  budgetMs?: number
  minJobStartBudgetMs?: number
  maxSteps?: number
  now?: () => number
}

export async function runScrapeWorker({
  maxJobs = MAX_JOBS_PER_WORKER_INVOCATION,
  teamId,
  requestId,
  budgetMs = WORKER_EXECUTION_BUDGET_MS,
  minJobStartBudgetMs = MIN_JOB_START_BUDGET_MS,
  maxSteps = MAX_JOB_STEPS_PER_INVOCATION,
  now = Date.now,
}: RunScrapeWorkerOptions = {}): Promise<{
  workerId: string
  recoveredStaleJobs: number
  results: ScrapeWorkerResult[]
  elapsedMs: number
  stopReason: ScrapeWorkerStopReason
}> {
  const invocationStartedAt = now()
  const safeMaxJobs = Math.max(1, Math.floor(maxJobs))
  const safeBudgetMs = Math.max(1, Math.floor(budgetMs))
  const safeMinJobStartBudgetMs = Math.min(
    safeBudgetMs,
    Math.max(1, Math.floor(minJobStartBudgetMs))
  )
  let remainingSteps = Math.max(1, Math.floor(maxSteps))
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
  let stopReason: ScrapeWorkerStopReason = "job_limit"

  for (let i = 0; i < safeMaxJobs; i++) {
    const remainingMs = Math.max(0, safeBudgetMs - (now() - invocationStartedAt))
    if (remainingMs < safeMinJobStartBudgetMs) {
      stopReason = "time_budget"
      break
    }
    if (remainingSteps < 1) {
      stopReason = "step_budget"
      break
    }

    const job = await claimNextScrapeJob(workerId, teamId)
    if (!job) {
      stopReason = "queue_empty"
      break
    }

    try {
      await recordScrapeJobEvent(job.id, job.scrape_id, "started", "Scrape job execution started", {
        workerId,
        type: job.type,
        target: job.target,
        workerRequestId: requestId,
      })
      const jobStepBudget = remainingSteps
      const jobTimeBudgetMs = Math.max(1, safeBudgetMs - (now() - invocationStartedAt))
      const execution = await runBoundedJobSteps({
        initialJob: job,
        runStep: runScrapeJob,
        refreshJob: async () => await getScrapeJobForWorker(job.id, workerId),
        budgetMs: jobTimeBudgetMs,
        maxSteps: jobStepBudget,
        now,
      })
      remainingSteps = Math.max(0, remainingSteps - execution.steps)
      let status: ScrapeWorkerResult["status"] = "succeeded"
      if (!execution.completed) {
        await recordScrapeJobEvent(
          job.id,
          job.scrape_id,
          "invocation_yielded",
          "Worker invocation yielded before the job completed",
          { workerId, steps: execution.steps, elapsedMs: execution.elapsedMs }
        )
        const transition = await requeueScrapeJob(job)
        status = transition.applied
          ? "queued"
          : transition.status === "canceled"
            ? "canceled"
            : "skipped"
        stopReason =
          execution.steps >= jobStepBudget
            ? "step_budget"
            : execution.elapsedMs >= jobTimeBudgetMs
              ? "time_budget"
              : "job_yielded"
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
      if (!execution.completed) break
    } catch (error) {
      stopReason = "job_error"
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
        break
      }
      if (error instanceof ScrapeJobLeaseLostError) {
        await recordScrapeJobEvent(job.id, job.scrape_id, "worker_lease_lost", message, { workerId })
        results.push({
          jobId: job.id,
          scrapeId: job.scrape_id,
          teamId: job.team_id,
          status: "skipped",
          error: message,
          originRequestId: job.request_id,
        })
        break
      }
      const transition = await failScrapeJob(job, message, {
        retryAfterMs: error instanceof GitHubApiError ? error.retryAfterMs : undefined,
      })
      results.push({
        jobId: job.id,
        scrapeId: job.scrape_id,
        teamId: job.team_id,
        status: transition.applied
          ? transition.status as "queued" | "failed"
          : transition.status === "canceled"
            ? "canceled"
            : "skipped",
        error: message,
        originRequestId: job.request_id,
      })
      break
    }
  }

  return {
    workerId,
    recoveredStaleJobs,
    results,
    elapsedMs: Math.max(0, now() - invocationStartedAt),
    stopReason,
  }
}
