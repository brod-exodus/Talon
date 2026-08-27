import { beforeEach, describe, expect, test, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  afterTasks: [] as Array<() => unknown | Promise<unknown>>,
  requirePermission: vi.fn(),
  requeue: vi.fn(),
  runTask: vi.fn(),
  recordAuditEvent: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}))

vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>()
  return { ...original, after: vi.fn((task: () => unknown | Promise<unknown>) => mocks.afterTasks.push(task)) }
})
vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/storage-cleanup-worker", () => ({
  requeueFailedStorageCleanupTasks: mocks.requeue,
  runStorageCleanupTask: mocks.runTask,
}))
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }))
vi.mock("@/lib/logger", () => ({ logError: mocks.logError, logInfo: mocks.logInfo }))

import { POST } from "@/app/api/storage-cleanup/retry/route"

const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
function request(): import("next/server").NextRequest {
  return new Request("https://talon.example/api/storage-cleanup/retry", {
    method: "POST",
    headers: { "X-Request-ID": REQUEST_ID, Origin: "https://talon.example" },
  }) as import("next/server").NextRequest
}

describe("POST /api/storage-cleanup/retry", () => {
  beforeEach(() => {
    mocks.afterTasks.length = 0
    mocks.requirePermission.mockReturnValue(null)
    mocks.requeue.mockResolvedValue(2)
    mocks.runTask.mockResolvedValue({ status: "succeeded" })
    mocks.recordAuditEvent.mockResolvedValue(undefined)
  })

  test("requires live admin permission before changing cleanup state", async () => {
    const denied = new Response(null, { status: 403 })
    mocks.requirePermission.mockReturnValue(denied)

    expect(await POST(request())).toBe(denied)
    expect(mocks.requeue).not.toHaveBeenCalled()
  })

  test("requeues terminal cleanup and schedules one immediate durable attempt", async () => {
    const response = await POST(request())

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ status: "queued", requeued: 2 })
    expect(mocks.afterTasks).toHaveLength(1)
    expect(mocks.runTask).not.toHaveBeenCalled()
    await mocks.afterTasks[0]?.()
    expect(mocks.runTask).toHaveBeenCalledOnce()
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "storage_cleanup.retry",
      outcome: "success",
      metadata: { requeued: 2 },
    }))
  })

  test("returns unchanged without dispatch when another operator already recovered the queue", async () => {
    mocks.requeue.mockResolvedValue(0)
    const response = await POST(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: "unchanged", requeued: 0 })
    expect(mocks.afterTasks).toHaveLength(0)
  })

  test("keeps cron recovery available when immediate dispatch fails", async () => {
    mocks.runTask.mockRejectedValue(new Error("temporary worker failure"))
    await POST(request())
    await mocks.afterTasks[0]?.()
    expect(mocks.logError).toHaveBeenCalledWith(
      "storage_cleanup.retry_dispatch_failed",
      expect.any(Error),
      { requestId: REQUEST_ID }
    )
  })

  test("returns a correlated safe error without exposing storage details", async () => {
    mocks.requeue.mockRejectedValue(new Error("bucket=private-object-path"))
    const response = await POST(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: "Failed to retry profile photo cleanup", requestId: REQUEST_ID })
    expect(JSON.stringify(body)).not.toContain("private-object-path")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure" }))
  })
})
