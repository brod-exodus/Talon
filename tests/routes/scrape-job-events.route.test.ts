import { beforeEach, describe, expect, test, vi } from "vitest"

const routeMocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  resolveTeamContext: vi.fn(),
  teamContextError: vi.fn(),
  getScrapeJobTimeline: vi.fn(),
  logError: vi.fn(),
}))

vi.mock("@/lib/permissions", () => ({ requirePermission: routeMocks.requirePermission }))
vi.mock("@/lib/team-context", () => ({
  resolveTeamContext: routeMocks.resolveTeamContext,
  teamContextError: routeMocks.teamContextError,
}))
vi.mock("@/lib/db", () => ({ getScrapeJobTimeline: routeMocks.getScrapeJobTimeline }))
vi.mock("@/lib/logger", () => ({ logError: routeMocks.logError }))

import { GET } from "@/app/api/scrape-jobs/[id]/events/route"

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

function request(): import("next/server").NextRequest {
  return new Request(`https://talon.example/api/scrape-jobs/${JOB_ID}/events`) as import("next/server").NextRequest
}

describe("GET /api/scrape-jobs/[id]/events", () => {
  beforeEach(() => {
    routeMocks.requirePermission.mockResolvedValue(null)
    routeMocks.resolveTeamContext.mockResolvedValue({ teamId: "team-1", teamSlug: "default" })
    routeMocks.getScrapeJobTimeline.mockResolvedValue([])
  })

  test("requires admin permission before reading workspace events", async () => {
    routeMocks.requirePermission.mockResolvedValue(new Response(null, { status: 403 }))
    const response = await GET(request(), { params: Promise.resolve({ id: JOB_ID }) })
    expect(response.status).toBe(403)
    expect(routeMocks.resolveTeamContext).not.toHaveBeenCalled()
    expect(routeMocks.getScrapeJobTimeline).not.toHaveBeenCalled()
  })

  test("returns only the team-scoped timeline with private caching", async () => {
    routeMocks.getScrapeJobTimeline.mockResolvedValue([{
      id: "event-1",
      eventType: "queued",
      label: "Queued for processing",
      category: "queue",
      occurredAt: "2026-08-22T12:00:00Z",
      detail: null,
    }])
    const response = await GET(request(), { params: Promise.resolve({ id: JOB_ID }) })
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(routeMocks.getScrapeJobTimeline).toHaveBeenCalledWith(JOB_ID, 100, "team-1")
    await expect(response.json()).resolves.toMatchObject({ events: [{ eventType: "queued" }] })
  })

  test("does not reveal whether another workspace owns a job", async () => {
    routeMocks.getScrapeJobTimeline.mockResolvedValue(null)
    const response = await GET(request(), { params: Promise.resolve({ id: JOB_ID }) })
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "Scrape job not found" })
  })

  test("returns a correlated safe error", async () => {
    routeMocks.getScrapeJobTimeline.mockRejectedValue(new Error("password=secret"))
    const response = await GET(request(), { params: Promise.resolve({ id: JOB_ID }) })
    const body = await response.json()
    expect(response.status).toBe(500)
    expect(body.error).toBe("Failed to fetch scrape job timeline")
    expect(JSON.stringify(body)).not.toContain("secret")
  })
})
