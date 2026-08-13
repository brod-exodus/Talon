import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const routeMocks = vi.hoisted(() => ({
  afterTasks: [] as Array<() => unknown | Promise<unknown>>,
  requirePermission: vi.fn(),
  resolveTeamContext: vi.fn(),
  teamContextError: vi.fn(),
  ecosystemExists: vi.fn(),
  getScrapeEnqueueRequest: vi.fn(),
  enqueueScrape: vi.fn(),
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
  getScrapeEnqueueRequest: routeMocks.getScrapeEnqueueRequest,
  enqueueScrape: routeMocks.enqueueScrape,
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

const IDEMPOTENCY_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const REQUEST_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

function scrapeRequest(
  body: unknown,
  idempotencyKey: string | null = IDEMPOTENCY_KEY
): import("next/server").NextRequest {
  const headers = new Headers({ "Content-Type": "application/json" })
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey)
  headers.set("X-Request-ID", REQUEST_ID)
  return new Request("https://talon.example/api/scrape", {
    method: "POST",
    headers,
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
    routeMocks.getScrapeEnqueueRequest.mockResolvedValue(null)
    routeMocks.enqueueScrape.mockImplementation(async (input: { scrapeId: string }) => ({
      scrapeId: input.scrapeId,
      jobId: "00000000-0000-4000-8000-000000000001",
      replayed: false,
    }))
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
    expect(routeMocks.enqueueScrape).not.toHaveBeenCalled()
  })

  test("requires a valid idempotency key before checking credentials or GitHub", async () => {
    const response = await POST(
      scrapeRequest({ type: "repository", target: "octocat/Hello-World" }, null)
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "A valid Idempotency-Key header is required" })
    expect(routeMocks.getScrapeEnqueueRequest).not.toHaveBeenCalled()
    expect(routeMocks.getRateLimit).not.toHaveBeenCalled()
    expect(routeMocks.enqueueScrape).not.toHaveBeenCalled()
  })

  test("returns 503 before writing anything when the server GitHub credential is missing", async () => {
    vi.stubEnv("GITHUB_TOKEN", "")

    const response = await POST(scrapeRequest({ type: "repository", target: "octocat/Hello-World" }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "GitHub access is not configured. Set GITHUB_TOKEN in the deployment environment.",
    })
    expect(routeMocks.enqueueScrape).not.toHaveBeenCalled()
    expect(routeMocks.afterTasks).toHaveLength(0)
  })

  test("returns 429 without creating a queue item when GitHub capacity is too low", async () => {
    routeMocks.getRateLimit.mockResolvedValue({ resources: { core: { limit: 5000, remaining: 50 } } })

    const response = await POST(scrapeRequest({ type: "repository", target: "octocat/Hello-World" }))

    expect(response.status).toBe(429)
    expect(routeMocks.repositoryExists).not.toHaveBeenCalled()
    expect(routeMocks.enqueueScrape).not.toHaveBeenCalled()
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
      jobId: "00000000-0000-4000-8000-000000000001",
      status: "queued",
      dispatch: "immediate",
      replayed: false,
      message: "Scrape queued",
      rateLimit: { limit: 5000, remaining: 4900 },
    })
    expect(body.scrapeId).toMatch(/^scrape-[0-9a-f-]+$/)
    expect(routeMocks.enqueueScrape).toHaveBeenCalledWith({
      scrapeId: body.scrapeId,
      idempotencyKey: IDEMPOTENCY_KEY,
      type: "repository",
      target: "octocat/Hello-World",
      minContributions: 2,
      projectId: null,
      requestId: REQUEST_ID,
      teamId: "team-1",
    })
    expect(routeMocks.afterTasks).toHaveLength(1)
    expect(routeMocks.runScrapeWorkerOperation).not.toHaveBeenCalled()

    await routeMocks.afterTasks[0]?.()
    expect(routeMocks.runScrapeWorkerOperation).toHaveBeenCalledWith({
      trigger: "queue",
      teamId: "team-1",
      teamSlug: "default",
      requestId: REQUEST_ID,
    })
  })

  test("replays the original queue response without touching GitHub or creating another scrape", async () => {
    routeMocks.getScrapeEnqueueRequest.mockResolvedValue({
      scrapeId: "scrape-original",
      jobId: "00000000-0000-4000-8000-000000000001",
      type: "repository",
      target: "octocat/Hello-World",
      minContributions: 1,
      projectId: null,
    })

    const response = await POST(scrapeRequest({ type: "repository", target: "octocat/Hello-World" }))

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      scrapeId: "scrape-original",
      jobId: "00000000-0000-4000-8000-000000000001",
      status: "queued",
      replayed: true,
    })
    expect(routeMocks.getRateLimit).not.toHaveBeenCalled()
    expect(routeMocks.repositoryExists).not.toHaveBeenCalled()
    expect(routeMocks.enqueueScrape).not.toHaveBeenCalled()
    expect(routeMocks.recordActivityEvent).not.toHaveBeenCalled()
    expect(routeMocks.afterTasks).toHaveLength(1)
  })

  test("rejects reuse of an idempotency key for a different request", async () => {
    routeMocks.getScrapeEnqueueRequest.mockResolvedValue({
      scrapeId: "scrape-original",
      jobId: "00000000-0000-4000-8000-000000000001",
      type: "repository",
      target: "octocat/Hello-World",
      minContributions: 1,
      projectId: null,
    })

    const response = await POST(scrapeRequest({ type: "repository", target: "vercel/next.js" }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "Idempotency key was already used for a different scrape request",
    })
    expect(routeMocks.getRateLimit).not.toHaveBeenCalled()
    expect(routeMocks.enqueueScrape).not.toHaveBeenCalled()
    expect(routeMocks.afterTasks).toHaveLength(0)
  })

  test("suppresses duplicate activity when a concurrent enqueue is replayed by the database", async () => {
    routeMocks.enqueueScrape.mockResolvedValue({
      scrapeId: "scrape-original",
      jobId: "00000000-0000-4000-8000-000000000001",
      replayed: true,
    })

    const response = await POST(scrapeRequest({ type: "repository", target: "octocat/Hello-World" }))

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({ scrapeId: "scrape-original", replayed: true })
    expect(routeMocks.recordActivityEvent).not.toHaveBeenCalled()
    expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ replayed: true }),
    }))
  })

  test("returns 409 when concurrent requests reuse a key for different input", async () => {
    routeMocks.enqueueScrape.mockRejectedValue(
      new Error("Idempotency key was already used for a different scrape request")
    )

    const response = await POST(scrapeRequest({ type: "repository", target: "octocat/Hello-World" }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: "Idempotency key was already used for a different scrape request",
    })
    expect(routeMocks.recordActivityEvent).not.toHaveBeenCalled()
    expect(routeMocks.recordAuditEvent).not.toHaveBeenCalled()
    expect(routeMocks.afterTasks).toHaveLength(0)
  })
})
