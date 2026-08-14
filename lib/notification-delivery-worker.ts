import "server-only"
import { randomUUID } from "node:crypto"
import {
  claimNextNotificationDelivery,
  completeNotificationDelivery,
  failNotificationDelivery,
  recoverStaleNotificationDeliveries,
  type NotificationDeliveryRow,
} from "@/lib/db"
import { logError, logInfo, sanitizeOperationalError } from "@/lib/logger"
import { deliverWatchedRepoNotification } from "@/lib/watched-repo-notifications"

const DEFAULT_MAX_DELIVERIES = 2
const DEFAULT_BUDGET_MS = 8_000
const MIN_DELIVERY_BUDGET_MS = 500
const STALE_DELIVERY_MS = 10 * 60 * 1000

export type NotificationDeliveryResult = {
  deliveryId: string
  status: "succeeded" | "queued" | "failed" | "skipped"
  outcome?: string
  error?: string
}

export type NotificationDeliveryWorkerResult = {
  workerId: string
  recoveredStaleDeliveries: number
  results: NotificationDeliveryResult[]
  elapsedMs: number
  stopReason: "queue_empty" | "job_limit" | "time_budget" | "job_error"
}

function watchedRepoPayload(delivery: NotificationDeliveryRow): {
  watchedRepoId: string
  scrapeId: string
} {
  const watchedRepoId = delivery.payload.watchedRepoId
  const scrapeId = delivery.payload.scrapeId
  if (typeof watchedRepoId !== "string" || typeof scrapeId !== "string") {
    throw new Error("Notification payload is incomplete")
  }
  return { watchedRepoId, scrapeId }
}

export async function runNotificationDeliveryWorker({
  maxDeliveries = DEFAULT_MAX_DELIVERIES,
  budgetMs = DEFAULT_BUDGET_MS,
  now = Date.now,
}: {
  maxDeliveries?: number
  budgetMs?: number
  now?: () => number
} = {}): Promise<NotificationDeliveryWorkerResult> {
  const startedAt = now()
  const safeMaxDeliveries = Math.max(1, Math.floor(maxDeliveries))
  const safeBudgetMs = Math.max(MIN_DELIVERY_BUDGET_MS, Math.floor(budgetMs))
  const workerId = `notification-worker-${randomUUID()}`
  const recoveredStaleDeliveries = await recoverStaleNotificationDeliveries(
    new Date(now() - STALE_DELIVERY_MS).toISOString()
  )
  const results: NotificationDeliveryResult[] = []
  let stopReason: NotificationDeliveryWorkerResult["stopReason"] = "job_limit"

  logInfo("notification_worker.started", {
    workerId,
    details: { maxDeliveries: safeMaxDeliveries, recoveredStaleDeliveries },
  })

  for (let index = 0; index < safeMaxDeliveries; index++) {
    const remainingMs = safeBudgetMs - (now() - startedAt)
    if (remainingMs < MIN_DELIVERY_BUDGET_MS) {
      stopReason = "time_budget"
      break
    }

    const delivery = await claimNextNotificationDelivery(workerId)
    if (!delivery) {
      stopReason = "queue_empty"
      break
    }

    try {
      if (delivery.kind !== "watched_repo.slack") {
        throw new Error("Unsupported notification delivery kind")
      }
      const payload = watchedRepoPayload(delivery)
      const outcome = await deliverWatchedRepoNotification({
        ...payload,
        teamId: delivery.team_id,
        timeoutMs: Math.min(5_000, Math.max(250, remainingMs)),
      })
      const transition = await completeNotificationDelivery(delivery, outcome)
      results.push({
        deliveryId: delivery.id,
        status: transition.applied ? "succeeded" : "skipped",
        outcome,
      })
    } catch (error) {
      const message = sanitizeOperationalError(error).message
      const transition = await failNotificationDelivery(delivery, message)
      results.push({
        deliveryId: delivery.id,
        status: transition.applied && transition.status === "queued"
          ? "queued"
          : transition.applied && transition.status === "failed"
            ? "failed"
            : "skipped",
        error: message,
      })
      logError("notification_worker.delivery_failed", error, {
        workerId,
        teamId: delivery.team_id,
        details: { deliveryId: delivery.id, attempt: delivery.attempts },
      })
      stopReason = "job_error"
      break
    }
  }

  const elapsedMs = Math.max(0, now() - startedAt)
  logInfo("notification_worker.finished", {
    workerId,
    details: {
      processed: results.length,
      statuses: results.map((result) => result.status),
      recoveredStaleDeliveries,
      elapsedMs,
      stopReason,
    },
  })
  return { workerId, recoveredStaleDeliveries, results, elapsedMs, stopReason }
}
