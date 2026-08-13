import { beforeEach, describe, expect, test, vi } from "vitest"

const routeMocks = vi.hoisted(() => ({
  afterTasks: [] as Array<() => unknown | Promise<unknown>>,
  requirePermission: vi.fn(),
  resolveTeamContext: vi.fn(),
  teamContextError: vi.fn(),
  retryScrapeJob: vi.fn(),
  recordAuditEvent: vi.fn(),
  runScrapeWorkerOperation: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}))

vi.mock("next/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("next/server")>()
  return {
    ...original,
    after: vi.fn((task: () => unknown | Promise<unknown>) => {
      routeMocks.afterTasks.push(task)
    }),
  }
})

vi.mock("@/lib/permissions", () => ({ requirePermission: routeMocks.requirePermission }))
vi.mock("@/lib/team-context", () => ({
  resolveTeamContext: routeMocks.resolveTeamContext,
  teamContextError: routeMocks.teamContextError,
}))
vi.mock("@/lib/db", () => ({ retryScrapeJob: routeMocks.retryScrapeJob }))
vi.mock("@/lib/audit", () => ({ recordAuditEvent: routeMocks.recordAuditEvent }))
vi.mock("@/lib/scrape-worker-operation", () => ({
  runScrapeWorkerOperation: routeMocks.runScrapeWorkerOperation,
}))
vi.mock("@/lib/logger", () => ({
  logError: routeMocks.logError,
  logInfo: routeMocks.logInfo,
}))

import { POST } from "@/app/api/scrape-jobs/[id]/retry/route"

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

function retryRequest(): import("next/server").NextRequest {
  return new Request(`https://talon.example/api/scrape-jobs/${JOB_ID}/retry`, {
    method: "POST",
    headers: { "X-Request-ID": REQUEST_ID },
  }) as import("next/server").NextRequest
}

describe("POST /api/scrape-jobs/[id]/retry", () => {
  beforeEach(() => {
    routeMocks.afterTasks.length = 0
    routeMocks.requirePermission.mockReturnValue(null)
    routeMocks.resolveTeamContext.mockResolvedValue({ teamId: "team-1", teamSlug: "default" })
    routeMocks.retryScrapeJob.mockResolvedValue({
      id: JOB_ID,
      scrapeId: "scrape-1",
      status: "queued",
    })
    routeMocks.runScrapeWorkerOperation.mockResolvedValue({})
  })

  test("rejects callers without write permission before touching the queue", async () => {
    routeMocks.requirePermission.mockReturnValue(new Response(null, { status: 403 }))

    const response = await POST(retryRequest(), { params: Promise.resolve({ id: JOB_ID }) })

    expect(response.status).toBe(403)
    expect(routeMocks.resolveTeamContext).not.toHaveBeenCalled()
    expect(routeMocks.retryScrapeJob).not.toHaveBeenCalled()
    expect(routeMocks.afterTasks).toHaveLength(0)
  })

  test("queues the retry and returns before worker execution begins", async () => {
    const response = await POST(retryRequest(), { params: Promise.resolve({ id: JOB_ID }) })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      job: { id: JOB_ID, scrapeId: "scrape-1", status: "queued" },
      status: "queued",
      dispatch: "immediate",
    })
    expect(routeMocks.retryScrapeJob).toHaveBeenCalledWith(JOB_ID, "team-1")
    expect(routeMocks.runScrapeWorkerOperation).not.toHaveBeenCalled()
    expect(routeMocks.afterTasks).toHaveLength(1)

    await routeMocks.afterTasks[0]?.()
    expect(routeMocks.runScrapeWorkerOperation).toHaveBeenCalledWith({
      trigger: "retry",
      teamId: "team-1",
      teamSlug: "default",
      requestId: REQUEST_ID,
    })
    expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "scrape.retry",
      outcome: "success",
      teamId: "team-1",
      metadata: expect.objectContaining({ workerScheduled: true }),
    }))
  })

  test("leaves cron recovery available when immediate dispatch fails", async () => {
    routeMocks.runScrapeWorkerOperation.mockRejectedValue(new Error("temporary worker failure"))

    const response = await POST(retryRequest(), { params: Promise.resolve({ id: JOB_ID }) })
    await routeMocks.afterTasks[0]?.()

    expect(response.status).toBe(202)
    expect(routeMocks.logError).toHaveBeenCalledWith(
      "scrape.retry_dispatch_failed",
      expect.any(Error),
      expect.objectContaining({ requestId: REQUEST_ID, jobId: JOB_ID, scrapeId: "scrape-1" })
    )
  })

  test("returns a conflict without scheduling work when the job cannot be retried", async () => {
    routeMocks.retryScrapeJob.mockRejectedValue(
      new Error("Only failed, canceled, or queued retry scrape jobs can be retried")
    )

    const response = await POST(retryRequest(), { params: Promise.resolve({ id: JOB_ID }) })

    expect(response.status).toBe(409)
    expect(routeMocks.afterTasks).toHaveLength(0)
  })
})
