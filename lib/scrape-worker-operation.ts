import "server-only"
import {
  runScrapeWorker,
  type ScrapeWorkerResult,
  type ScrapeWorkerStopReason,
} from "@/lib/scrape-worker"
import { MAX_JOBS_PER_WORKER_INVOCATION } from "@/lib/worker-budget"
import { logError, logInfo, sanitizeOperationalError } from "@/lib/logger"
import { finishSystemRun, startSystemRun } from "@/lib/system-runs"
import {
  runNotificationDeliveryWorker,
  type NotificationDeliveryWorkerResult,
} from "@/lib/notification-delivery-worker"

export type ScrapeWorkerTrigger = "cron" | "manual" | "queue" | "retry"

export type ScrapeWorkerOperation = {
  workerId: string
  recoveredStaleJobs: number
  results: ScrapeWorkerResult[]
  hasFailedResult: boolean
  steps: number
  maxElapsedMs: number
  elapsedMs: number
  stopReason: ScrapeWorkerStopReason
  notificationDeliveries: NotificationDeliveryWorkerResult & { error?: string }
}

export async function runScrapeWorkerOperation({
  trigger,
  teamId,
  teamSlug,
  maxJobs = MAX_JOBS_PER_WORKER_INVOCATION,
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
    let notificationDeliveries: NotificationDeliveryWorkerResult & { error?: string } = {
      workerId: "not-run",
      recoveredStaleDeliveries: 0,
      results: [],
      elapsedMs: 0,
      stopReason: "queue_empty",
    }
    // Keep user-triggered scrape starts and retries fast. The one-minute cron
    // invocation owns outbound delivery; an explicit manual worker run can
    // also drain it for operator recovery.
    if (trigger === "cron" || trigger === "manual") {
      try {
        notificationDeliveries = await runNotificationDeliveryWorker()
      } catch (error) {
        const sanitized = sanitizeOperationalError(error).message
        logError("notification_worker.failed", error, { requestId, systemRunId })
        notificationDeliveries = {
          workerId: "unavailable",
          recoveredStaleDeliveries: 0,
          results: [],
          elapsedMs: 0,
          stopReason: "job_error",
          error: sanitized,
        }
      }
    }
    const { workerId, recoveredStaleJobs, results, elapsedMs, stopReason } = await runScrapeWorker({
      maxJobs,
      teamId,
      requestId,
    })
    const hasFailedResult = results.some((result) => result.status === "failed")
      || Boolean(notificationDeliveries.error)
      || notificationDeliveries.results.some((result) => result.status === "failed")
    const steps = results.reduce((total, result) => total + (result.steps ?? 0), 0)
    const maxElapsedMs = Math.max(0, ...results.map((result) => result.elapsedMs ?? 0))

    await finishSystemRun(systemRunId, hasFailedResult ? "failure" : "success", {
      workerId,
      recoveredStaleJobs,
      processed: results.length,
      statuses: results.map((result) => result.status),
      steps,
      maxElapsedMs,
      elapsedMs,
      stopReason,
      trigger,
      originRequestIds: results.map((result) => result.originRequestId).filter(Boolean),
      notificationDeliveries,
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
        elapsedMs,
        stopReason,
        notificationDeliveryStatuses: notificationDeliveries.results.map((result) => result.status),
      },
    })

    return {
      workerId,
      recoveredStaleJobs,
      results,
      hasFailedResult,
      steps,
      maxElapsedMs,
      elapsedMs,
      stopReason,
      notificationDeliveries,
    }
  } catch (error) {
    await finishSystemRun(systemRunId, "failure", { trigger }, error)
    logError("scrape_worker.failed", error, { requestId, systemRunId, details: { trigger } })
    throw error
  }
}
