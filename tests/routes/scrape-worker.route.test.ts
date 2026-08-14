import { beforeEach, describe, expect, test, vi } from "vitest"

const routeMocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  resolveTeamContext: vi.fn(),
  teamContextError: vi.fn(),
  runScrapeWorkerOperation: vi.fn(),
  recordAuditEvent: vi.fn(),
  enqueueDueWatchedRepoScrapes: vi.fn(),
}))

vi.mock("@/lib/permissions", () => ({ requirePermission: routeMocks.requirePermission }))
vi.mock("@/lib/team-context", () => ({
  resolveTeamContext: routeMocks.resolveTeamContext,
  teamContextError: routeMocks.teamContextError,
}))
vi.mock("@/lib/scrape-worker-operation", () => ({
  runScrapeWorkerOperation: routeMocks.runScrapeWorkerOperation,
}))
vi.mock("@/lib/audit", () => ({ recordAuditEvent: routeMocks.recordAuditEvent }))
vi.mock("@/lib/db", () => ({
  enqueueDueWatchedRepoScrapes: routeMocks.enqueueDueWatchedRepoScrapes,
}))

import { POST } from "@/app/api/scrape-jobs/run/route"

function workerRequest(authorization?: string): import("next/server").NextRequest {
  return new Request("https://talon.example/api/scrape-jobs/run", {
    method: "POST",
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      "X-Request-ID": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
  }) as import("next/server").NextRequest
}

describe("POST /api/scrape-jobs/run", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret")
    routeMocks.requirePermission.mockReturnValue(null)
    routeMocks.resolveTeamContext.mockResolvedValue({ teamId: "team-1", teamSlug: "default" })
    routeMocks.runScrapeWorkerOperation.mockResolvedValue({
      workerId: "worker-1",
      recoveredStaleJobs: 0,
      results: [],
      hasFailedResult: false,
      steps: 0,
      maxElapsedMs: 0,
      elapsedMs: 5,
      stopReason: "queue_empty",
      notificationDeliveries: {
        workerId: "notification-worker-1",
        recoveredStaleDeliveries: 0,
        results: [],
        elapsedMs: 1,
        stopReason: "queue_empty",
      },
    })
    routeMocks.enqueueDueWatchedRepoScrapes.mockResolvedValue([])
  })

  test("accepts the exact cron bearer secret without requiring a user session", async () => {
    const response = await POST(workerRequest("Bearer cron-test-secret"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      processed: 0,
      elapsedMs: 5,
      stopReason: "queue_empty",
    })
    expect(routeMocks.requirePermission).not.toHaveBeenCalled()
    expect(routeMocks.resolveTeamContext).not.toHaveBeenCalled()
    expect(routeMocks.runScrapeWorkerOperation).toHaveBeenCalledWith({
      trigger: "cron",
      teamId: undefined,
      teamSlug: undefined,
      maxJobs: 5,
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    })
    expect(routeMocks.enqueueDueWatchedRepoScrapes).toHaveBeenCalledWith({
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    })
  })

  test("rejects an invalid cron secret when no authorized user session exists", async () => {
    routeMocks.requirePermission.mockReturnValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    )

    const response = await POST(workerRequest("Bearer wrong-secret"))

    expect(response.status).toBe(401)
    expect(routeMocks.requirePermission).toHaveBeenCalledOnce()
    expect(routeMocks.runScrapeWorkerOperation).not.toHaveBeenCalled()
  })

  test("allows an authorized manual run and scopes it to the operator's team", async () => {
    const response = await POST(workerRequest())

    expect(response.status).toBe(200)
    expect(routeMocks.requirePermission).toHaveBeenCalledOnce()
    expect(routeMocks.runScrapeWorkerOperation).toHaveBeenCalledWith({
      trigger: "manual",
      teamId: "team-1",
      teamSlug: "default",
      maxJobs: 5,
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    })
    expect(routeMocks.enqueueDueWatchedRepoScrapes).not.toHaveBeenCalled()
  })
})
