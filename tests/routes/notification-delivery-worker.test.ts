import { beforeEach, describe, expect, test, vi } from "vitest"

const deliveryMocks = vi.hoisted(() => ({
  recoverStaleNotificationDeliveries: vi.fn(),
  claimNextNotificationDelivery: vi.fn(),
  completeNotificationDelivery: vi.fn(),
  failNotificationDelivery: vi.fn(),
  deliverWatchedRepoNotification: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/db", () => ({
  recoverStaleNotificationDeliveries: deliveryMocks.recoverStaleNotificationDeliveries,
  claimNextNotificationDelivery: deliveryMocks.claimNextNotificationDelivery,
  completeNotificationDelivery: deliveryMocks.completeNotificationDelivery,
  failNotificationDelivery: deliveryMocks.failNotificationDelivery,
}))
vi.mock("@/lib/watched-repo-notifications", () => ({
  deliverWatchedRepoNotification: deliveryMocks.deliverWatchedRepoNotification,
}))

import { runNotificationDeliveryWorker } from "@/lib/notification-delivery-worker"

const delivery = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  team_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  kind: "watched_repo.slack" as const,
  dedupe_key: "watched_repo:watch-scrape-1",
  payload: {
    watchedRepoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    scrapeId: "watch-scrape-1",
  },
  status: "running" as const,
  attempts: 1,
  max_attempts: 5,
  run_after: "2026-08-14T12:00:00.000Z",
  locked_at: "2026-08-14T12:00:00.000Z",
  locked_by: "notification-worker-test",
  last_error: null,
  created_at: "2026-08-14T12:00:00.000Z",
  updated_at: "2026-08-14T12:00:00.000Z",
  completed_at: null,
}

describe("notification delivery worker", () => {
  beforeEach(() => {
    deliveryMocks.recoverStaleNotificationDeliveries.mockResolvedValue(0)
    deliveryMocks.claimNextNotificationDelivery.mockResolvedValueOnce(delivery).mockResolvedValue(null)
    deliveryMocks.deliverWatchedRepoNotification.mockResolvedValue("sent")
    deliveryMocks.completeNotificationDelivery.mockResolvedValue({ applied: true, status: "succeeded" })
    deliveryMocks.failNotificationDelivery.mockResolvedValue({ applied: true, status: "queued" })
  })

  test("claims and completes a Slack delivery through its database lease", async () => {
    const result = await runNotificationDeliveryWorker({ maxDeliveries: 2 })

    expect(result.results).toEqual([{ deliveryId: delivery.id, status: "succeeded", outcome: "sent" }])
    expect(result.stopReason).toBe("queue_empty")
    expect(deliveryMocks.deliverWatchedRepoNotification).toHaveBeenCalledWith(expect.objectContaining({
      watchedRepoId: delivery.payload.watchedRepoId,
      scrapeId: delivery.payload.scrapeId,
      teamId: delivery.team_id,
    }))
    expect(deliveryMocks.completeNotificationDelivery).toHaveBeenCalledWith(delivery, "sent")
  })

  test("persists a retry and stops the invocation after a delivery error", async () => {
    deliveryMocks.deliverWatchedRepoNotification.mockRejectedValue(new Error("Slack unavailable"))

    const result = await runNotificationDeliveryWorker({ maxDeliveries: 2 })

    expect(result.results[0]).toMatchObject({
      deliveryId: delivery.id,
      status: "queued",
      error: "Slack unavailable",
    })
    expect(result.stopReason).toBe("job_error")
    expect(deliveryMocks.failNotificationDelivery).toHaveBeenCalledWith(delivery, "Slack unavailable")
    expect(deliveryMocks.claimNextNotificationDelivery).toHaveBeenCalledOnce()
  })

  test("finishes invalid configuration without burning retry attempts", async () => {
    deliveryMocks.deliverWatchedRepoNotification.mockResolvedValue("invalid_configuration")

    const result = await runNotificationDeliveryWorker({ maxDeliveries: 1 })

    expect(result.results[0]).toMatchObject({ status: "succeeded", outcome: "invalid_configuration" })
    expect(deliveryMocks.failNotificationDelivery).not.toHaveBeenCalled()
  })
})
