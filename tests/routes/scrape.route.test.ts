import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const routeMocks = vi.hoisted(() => ({
  afterTasks: [] as Array<() => unknown | Promise<unknown>>,
  requirePermission: vi.fn(),
  resolveTeamContext: vi.fn(),
  teamContextError: vi.fn(),
  ecosystemExists: vi.fn(),
  createScrape: vi.fn(),
  createScrapeJob: vi.fn(),
  addScrapeToEcosystem: vi.fn(),
  recordActivityEvent: vi.fn(),
  recordAuditEvent: vi.fn(),
  runScrapeWorkerOperation: vi.fn(),
  getRateLimit: vi.fn(),
  repositoryExists: vi.fn(),
  organizationExists: vi.fn(),
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
  ecosystemExists: routeMocks.ecosystemExists,
  createScrape: routeMocks.createScrape,
  createScrapeJob: routeMocks.createScrapeJob,
  addScrapeToEcosystem: routeMocks.addScrapeToEcosystem,
}))
vi.mock("@/lib/activity", () => ({ recordActivityEvent: routeMocks.recordActivityEvent }))
vi.mock("@/lib/audit", () => ({ recordAuditEvent: routeMocks.recordAuditEvent }))
vi.mock("@/lib/scrape-worker-operation", () => ({
  runScrapeWorkerOperation: routeMocks.runScrapeWorkerOperation,
}))
vi.mock("@/lib/github", () => ({
  createGitHubClient: () => ({
    getRateLimit: routeMocks.getRateLimit,
    repositoryExists: routeMocks.repositoryExists,
    organizationExists: routeMocks.organizationExists,
  }),
}))

import { POST } from "@/app/api/scrape/route"

function scrapeRequest(body: unknown): import("next/server").NextRequest {
  return new Request("https://talon.example/api/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as import("next/server").NextRequest
}

describe("POST /api/scrape", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "github-test-token")
    routeMocks.afterTasks.length = 0
    routeMocks.requirePermission.mockReturnValue(null)
    routeMocks.resolveTeamContext.mockResolvedValue({
      teamId: "team-1",
      teamSlug: "default",
      email: "operator@example.com",
    })
    routeMocks.getRateLimit.mockResolvedValue({ resources: { core: { limit: 5000, remaining: 4900 } } })
    routeMocks.repositoryExists.mockResolvedValue(true)
    routeMocks.organizationExists.mockResolvedValue(true)
    routeMocks.ecosystemExists.mockResolvedValue(true)
    routeMocks.createScrapeJob.mockResolvedValue({ id: "job-1" })
    routeMocks.runScrapeWorkerOperation.mockResolvedValue({})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test("rejects callers without write access before resolving a team or touching GitHub", async () => {
    routeMocks.requirePermission.mockReturnValue(
      new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })
    )

    const response = await POST(scrapeRequest({ type: "repository", target: "octocat/Hello-World" }))

    expect(response.status).toBe(403)
    expect(routeMocks.resolveTeamContext).not.toHaveBeenCalled()
    expect(routeMocks.getRateLimit).not.toHaveBeenCalled()
    expect(routeMocks.createScrapeJob).not.toHaveBeenCalled()
  })

  test("returns 503 before writing anything when the server GitHub credential is missing", async () => {
    vi.stubEnv("GITHUB_TOKEN", "")

    const response = await POST(scrapeRequest({ type: "repository", target: "octocat/Hello-World" }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "GitHub access is not configured. Set GITHUB_TOKEN in the deployment environment.",
    })
    expect(routeMocks.createScrape).not.toHaveBeenCalled()
    expect(routeMocks.createScrapeJob).not.toHaveBeenCalled()
    expect(routeMocks.afterTasks).toHaveLength(0)
  })

  test("returns 429 without creating a queue item when GitHub capacity is too low", async () => {
    routeMocks.getRateLimit.mockResolvedValue({ resources: { core: { limit: 5000, remaining: 50 } } })

    const response = await POST(scrapeRequest({ type: "repository", target: "octocat/Hello-World" }))

    expect(response.status).toBe(429)
    expect(routeMocks.repositoryExists).not.toHaveBeenCalled()
    expect(routeMocks.createScrapeJob).not.toHaveBeenCalled()
  })

  test("creates a durable queue item, returns 202, and dispatches the worker after the response", async () => {
    const response = await POST(
      scrapeRequest({
        type: "repository",
        target: "https://github.com/octocat/Hello-World",
        minContributions: 2,
      })
    )
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body).toMatchObject({
      jobId: "job-1",
      status: "queued",
      dispatch: "immediate",
      message: "Scrape queued",
      rateLimit: { limit: 5000, remaining: 4900 },
    })
    expect(body.scrapeId).toMatch(/^scrape-[0-9a-f-]+$/)
    expect(routeMocks.createScrape).toHaveBeenCalledWith(
      body.scrapeId,
      "repository",
      "octocat/Hello-World",
      2,
      "team-1"
    )
    expect(routeMocks.createScrapeJob).toHaveBeenCalledWith(
      body.scrapeId,
      "repository",
      "octocat/Hello-World",
      2,
      "team-1"
    )
    expect(routeMocks.afterTasks).toHaveLength(1)
    expect(routeMocks.runScrapeWorkerOperation).not.toHaveBeenCalled()

    await routeMocks.afterTasks[0]?.()
    expect(routeMocks.runScrapeWorkerOperation).toHaveBeenCalledWith({
      trigger: "queue",
      teamId: "team-1",
      teamSlug: "default",
    })
  })
})
