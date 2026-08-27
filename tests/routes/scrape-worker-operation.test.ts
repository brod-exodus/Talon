import { beforeEach, describe, expect, test, vi } from "vitest"

const operationMocks = vi.hoisted(() => ({
  runNotificationDeliveryWorker: vi.fn(),
  runScrapeWorker: vi.fn(),
  startSystemRun: vi.fn(),
  finishSystemRun: vi.fn(),
  runStorageCleanupTask: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/notification-delivery-worker", () => ({
  runNotificationDeliveryWorker: operationMocks.runNotificationDeliveryWorker,
}))
vi.mock("@/lib/scrape-worker", () => ({ runScrapeWorker: operationMocks.runScrapeWorker }))
vi.mock("@/lib/system-runs", () => ({
  startSystemRun: operationMocks.startSystemRun,
  finishSystemRun: operationMocks.finishSystemRun,
}))
vi.mock("@/lib/worker-budget", () => ({ MAX_JOBS_PER_WORKER_INVOCATION: 5 }))
vi.mock("@/lib/storage-cleanup-worker", () => ({ runStorageCleanupTask: operationMocks.runStorageCleanupTask }))

import { runScrapeWorkerOperation } from "@/lib/scrape-worker-operation"

describe("scrape worker operation notification isolation", () => {
  beforeEach(() => {
    operationMocks.startSystemRun.mockResolvedValue("run-1")
    operationMocks.finishSystemRun.mockResolvedValue(undefined)
    operationMocks.runNotificationDeliveryWorker.mockResolvedValue({
      workerId: "notification-worker-1",
      recoveredStaleDeliveries: 0,
      results: [],
      elapsedMs: 1,
      stopReason: "queue_empty",
    })
    operationMocks.runStorageCleanupTask.mockResolvedValue({ taskId: null, status: "empty", recoveredStaleTasks: 0 })
    operationMocks.runScrapeWorker.mockResolvedValue({
      workerId: "scrape-worker-1",
      recoveredStaleJobs: 0,
      results: [],
      elapsedMs: 2,
      stopReason: "queue_empty",
    })
  })

  test("continues scrape work when notification infrastructure fails", async () => {
    operationMocks.runNotificationDeliveryWorker.mockRejectedValue(
      new Error("Authorization: Bearer secret-value")
    )

    const result = await runScrapeWorkerOperation({ trigger: "cron", requestId: "request-1" })

    expect(operationMocks.runScrapeWorker).toHaveBeenCalledOnce()
    expect(result.hasFailedResult).toBe(true)
    expect(result.notificationDeliveries.error).toBe("Authorization: Bearer [redacted]")
    expect(operationMocks.finishSystemRun).toHaveBeenCalledWith(
      "run-1",
      "failure",
      expect.objectContaining({ notificationDeliveries: expect.objectContaining({ stopReason: "job_error" }) })
    )
  })

  test("continues scrape work when profile photo cleanup infrastructure fails", async () => {
    operationMocks.runStorageCleanupTask.mockRejectedValue(
      new Error("service_role_key=secret-value")
    )

    const result = await runScrapeWorkerOperation({ trigger: "cron", requestId: "request-storage" })

    expect(operationMocks.runScrapeWorker).toHaveBeenCalledOnce()
    expect(result.hasFailedResult).toBe(true)
    expect(result.storageCleanup.error).toBe("service_role_key [redacted]")
    expect(operationMocks.finishSystemRun).toHaveBeenCalledWith(
      "run-1",
      "failure",
      expect.objectContaining({ storageCleanup: expect.objectContaining({ status: "failed" }) })
    )
  })

  test("keeps immediate queue dispatch focused on the newly started scrape", async () => {
    const result = await runScrapeWorkerOperation({ trigger: "queue", requestId: "request-2" })

    expect(operationMocks.runNotificationDeliveryWorker).not.toHaveBeenCalled()
    expect(operationMocks.runStorageCleanupTask).not.toHaveBeenCalled()
    expect(operationMocks.runScrapeWorker).toHaveBeenCalledOnce()
    expect(result.notificationDeliveries.workerId).toBe("not-run")
  })
})
