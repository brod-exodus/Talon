import { beforeEach, describe, expect, test, vi } from "vitest"

const routeMocks = vi.hoisted(() => ({
  afterTasks: [] as Array<() => unknown | Promise<unknown>>,
  requirePermission: vi.fn(),
  resolveTeamContext: vi.fn(),
  teamContextError: vi.fn(),
  enqueueDueWatchedRepoScrapes: vi.fn(),
  runScrapeWorkerOperation: vi.fn(),
  recordAuditEvent: vi.fn(),
  startSystemRun: vi.fn(),
  finishSystemRun: vi.fn(),
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
vi.mock("@/lib/db", () => ({
  enqueueDueWatchedRepoScrapes: routeMocks.enqueueDueWatchedRepoScrapes,
}))
vi.mock("@/lib/scrape-worker-operation", () => ({
  runScrapeWorkerOperation: routeMocks.runScrapeWorkerOperation,
}))
vi.mock("@/lib/audit", () => ({ recordAuditEvent: routeMocks.recordAuditEvent }))
vi.mock("@/lib/system-runs", () => ({
  startSystemRun: routeMocks.startSystemRun,
  finishSystemRun: routeMocks.finishSystemRun,
}))

import { POST } from "@/app/api/watched-repos/check/route"

const REQUEST_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

function checkRequest(authorization?: string): import("next/server").NextRequest {
  return new Request("https://talon.example/api/watched-repos/check", {
    method: "POST",
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      "X-Request-ID": REQUEST_ID,
    },
  }) as import("next/server").NextRequest
}

describe("POST /api/watched-repos/check", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-test-secret")
    routeMocks.afterTasks.length = 0
    routeMocks.requirePermission.mockReturnValue(null)
    routeMocks.resolveTeamContext.mockResolvedValue({ teamId: "team-1", teamSlug: "default" })
    routeMocks.startSystemRun.mockResolvedValue("run-1")
    routeMocks.finishSystemRun.mockResolvedValue(undefined)
    routeMocks.runScrapeWorkerOperation.mockResolvedValue({})
    routeMocks.enqueueDueWatchedRepoScrapes.mockResolvedValue([
      {
        watchedRepoId: "watch-1",
        repo: "octocat/Hello-World",
        scrapeId: "watch-scrape-1",
        jobId: "job-1",
        replayed: false,
      },
    ])
  })

  test("queues manual checks and returns 202 without waiting for the worker", async () => {
    const response = await POST(checkRequest())

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ status: "queued", queued: 1 })
    expect(routeMocks.enqueueDueWatchedRepoScrapes).toHaveBeenCalledWith({
      teamId: "team-1",
      force: true,
      requestId: REQUEST_ID,
    })
    expect(routeMocks.runScrapeWorkerOperation).not.toHaveBeenCalled()
    expect(routeMocks.afterTasks).toHaveLength(1)

    await routeMocks.afterTasks[0]()
    expect(routeMocks.runScrapeWorkerOperation).toHaveBeenCalledWith({
      trigger: "queue",
      teamId: "team-1",
      teamSlug: "default",
      requestId: REQUEST_ID,
    })
  })

  test("cron requests enqueue only due repositories across teams", async () => {
    const response = await POST(checkRequest("Bearer cron-test-secret"))

    expect(response.status).toBe(202)
    expect(routeMocks.requirePermission).not.toHaveBeenCalled()
    expect(routeMocks.resolveTeamContext).not.toHaveBeenCalled()
    expect(routeMocks.enqueueDueWatchedRepoScrapes).toHaveBeenCalledWith({
      teamId: undefined,
      force: false,
      requestId: REQUEST_ID,
    })
  })

  test("rejects callers without write permission before queueing", async () => {
    routeMocks.requirePermission.mockReturnValue(new Response(null, { status: 403 }))

    const response = await POST(checkRequest())

    expect(response.status).toBe(403)
    expect(routeMocks.enqueueDueWatchedRepoScrapes).not.toHaveBeenCalled()
    expect(routeMocks.afterTasks).toHaveLength(0)
  })
})
