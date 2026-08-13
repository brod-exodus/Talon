import "server-only"
import { runScrapeWorker, type ScrapeWorkerResult } from "@/lib/scrape-worker"
import { logError, logInfo } from "@/lib/logger"
import { finishSystemRun, startSystemRun } from "@/lib/system-runs"

export type ScrapeWorkerTrigger = "cron" | "manual" | "queue" | "retry"

export type ScrapeWorkerOperation = {
  workerId: string
  recoveredStaleJobs: number
  results: ScrapeWorkerResult[]
  hasFailedResult: boolean
  steps: number
  maxElapsedMs: number
}

export async function runScrapeWorkerOperation({
  trigger,
  teamId,
  teamSlug,
  maxJobs = 1,
  requestId,
}: {
  trigger: ScrapeWorkerTrigger
  teamId?: string
  teamSlug?: string
  maxJobs?: number
  requestId?: string
}): Promise<ScrapeWorkerOperation> {
  const systemRunId = await startSystemRun("scrape_worker", { trigger, teamSlug }, requestId)
  logInfo("scrape_worker.started", { requestId, systemRunId, details: { trigger, maxJobs } })

  try {
    const { workerId, recoveredStaleJobs, results } = await runScrapeWorker(maxJobs, teamId, requestId)
    const hasFailedResult = results.some((result) => result.status === "failed")
    const steps = results.reduce((total, result) => total + (result.steps ?? 0), 0)
    const maxElapsedMs = Math.max(0, ...results.map((result) => result.elapsedMs ?? 0))

    await finishSystemRun(systemRunId, hasFailedResult ? "failure" : "success", {
      workerId,
      recoveredStaleJobs,
      processed: results.length,
      statuses: results.map((result) => result.status),
      steps,
      maxElapsedMs,
      trigger,
      originRequestIds: results.map((result) => result.originRequestId).filter(Boolean),
    })

    logInfo("scrape_worker.finished", {
      requestId,
      systemRunId,
      workerId,
      details: {
        trigger,
        processed: results.length,
        statuses: results.map((result) => result.status),
        recoveredStaleJobs,
        steps,
        maxElapsedMs,
      },
    })

    return {
      workerId,
      recoveredStaleJobs,
      results,
      hasFailedResult,
      steps,
      maxElapsedMs,
    }
  } catch (error) {
    await finishSystemRun(systemRunId, "failure", { trigger }, error)
    logError("scrape_worker.failed", error, { requestId, systemRunId, details: { trigger } })
    throw error
  }
}
