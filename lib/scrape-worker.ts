import { randomUUID } from "node:crypto"
import {
  cancelScrapeJob,
  claimNextScrapeJob,
  failScrapeJob,
  getActiveGitHubCooldown,
  getScrapeJobForWorker,
  recoverStaleScrapeJobs,
  recordScrapeJobEvent,
  requeueScrapeJob,
} from "@/lib/db"
import { getGitHubCooldownReason, GitHubApiError } from "@/lib/github"
import { runScrapeJob, ScrapeJobCanceledError, ScrapeJobLeaseLostError } from "@/lib/scrape-runner"
import {
  estimateScrapeStepGitHubRequests,
  MAX_GITHUB_REQUESTS_PER_SCRAPE_STEP,
} from "@/lib/scrape-step"
import {
  MAX_GITHUB_REQUESTS_PER_WORKER_INVOCATION,
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
  estimatedGitHubRequests?: number
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
  | "github_cooldown"
  | "request_budget"

type RunScrapeWorkerOptions = {
  maxJobs?: number
  teamId?: string
  requestId?: string
  budgetMs?: number
  minJobStartBudgetMs?: number
  maxSteps?: number
  maxGitHubRequests?: number
  now?: () => number
}

export async function runScrapeWorker({
  maxJobs = MAX_JOBS_PER_WORKER_INVOCATION,
  teamId,
  requestId,
  budgetMs = WORKER_EXECUTION_BUDGET_MS,
  minJobStartBudgetMs = MIN_JOB_START_BUDGET_MS,
  maxSteps = MAX_JOB_STEPS_PER_INVOCATION,
  maxGitHubRequests = MAX_GITHUB_REQUESTS_PER_WORKER_INVOCATION,
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
  let remainingGitHubRequests = Math.max(1, Math.floor(maxGitHubRequests))
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
    if (remainingGitHubRequests < MAX_GITHUB_REQUESTS_PER_SCRAPE_STEP) {
      stopReason = "request_budget"
      break
    }

    const job = await claimNextScrapeJob(workerId, teamId)
    if (!job) {
      stopReason = await getActiveGitHubCooldown(now()) ? "github_cooldown" : "queue_empty"
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
        getStepCost: estimateScrapeStepGitHubRequests,
        costBudget: remainingGitHubRequests,
      })
      remainingSteps = Math.max(0, remainingSteps - execution.steps)
      const executionCost = execution.cost ?? 0
      remainingGitHubRequests = Math.max(0, remainingGitHubRequests - executionCost)
      let status: ScrapeWorkerResult["status"] = "succeeded"
      if (!execution.completed) {
        await recordScrapeJobEvent(
          job.id,
          job.scrape_id,
          "invocation_yielded",
          "Worker invocation yielded before the job completed",
          { workerId, steps: execution.steps, elapsedMs: execution.elapsedMs, estimatedGitHubRequests: executionCost }
        )
        const transition = await requeueScrapeJob(job)
        status = transition.applied
          ? "queued"
          : transition.status === "canceled"
            ? "canceled"
            : "skipped"
        stopReason =
          execution.limit === "cost"
            ? "request_budget"
            : execution.steps >= jobStepBudget
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
        estimatedGitHubRequests: executionCost,
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
      const githubCooldownReason = getGitHubCooldownReason(error)
      const transition = await failScrapeJob(job, message, {
        retryAfterMs: error instanceof GitHubApiError ? error.retryAfterMs : undefined,
        githubCooldownReason: githubCooldownReason ?? undefined,
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
