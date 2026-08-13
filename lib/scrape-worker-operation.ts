import "server-only"
import { runScrapeWorker, type ScrapeWorkerResult } from "@/lib/scrape-worker"
import { finishSystemRun, startSystemRun } from "@/lib/system-runs"

export type ScrapeWorkerTrigger = "cron" | "manual" | "queue"

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
}: {
  trigger: ScrapeWorkerTrigger
  teamId?: string
  teamSlug?: string
  maxJobs?: number
}): Promise<ScrapeWorkerOperation> {
  const systemRunId = await startSystemRun("scrape_worker", { trigger, teamSlug })

  try {
    const { workerId, recoveredStaleJobs, results } = await runScrapeWorker(maxJobs, teamId)
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
    throw error
  }
}
