import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const keepaliveMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  insertRun: vi.fn(),
  rpc: vi.fn(),
  fetch: vi.fn(),
  state: {
    databaseError: null as Error | null,
    previousRunError: null as Error | null,
    previousRunDetails: null as Record<string, unknown> | null,
    sloError: null as Error | null,
    sloRows: [] as Array<{ status: "completed" | "failed"; started_at: string; completed_at: string | null }>,
  },
}))

vi.mock("@supabase/supabase-js", () => ({ createClient: keepaliveMocks.createClient }))

import { GET } from "@/app/api/keepalive/route"

function request(secret = "test-cron-secret") {
  return new NextRequest("https://talon.example/api/keepalive", {
    headers: { Authorization: `Bearer ${secret}` },
  })
}

describe("GET /api/keepalive", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.supabase.co")
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-value")
    vi.stubGlobal("fetch", keepaliveMocks.fetch)
    keepaliveMocks.state.databaseError = null
    keepaliveMocks.state.previousRunError = null
    keepaliveMocks.state.previousRunDetails = null
    keepaliveMocks.state.sloError = null
    keepaliveMocks.state.sloRows = []
    keepaliveMocks.fetch.mockResolvedValue({ ok: true, status: 200 })
    keepaliveMocks.rpc.mockImplementation(async (name: string) => name === "cleanup_notification_delivery_retention"
      ? { data: 0, error: null }
      : { data: { shares: 1, systemRuns: 2, scrapeJobs: 3 }, error: null })
    keepaliveMocks.insertRun.mockResolvedValue({ error: null })
    keepaliveMocks.createClient.mockReturnValue({
      rpc: keepaliveMocks.rpc,
      from(table: string) {
        if (table === "team_memberships") {
          return {
            select: () => ({
              limit: async () => ({ error: keepaliveMocks.state.databaseError }),
            }),
          }
        }
        if (table === "scrapes") {
          const query = {
            eq: () => query,
            in: () => query,
            is: () => query,
            gte: () => query,
            order: () => query,
            limit: async () => ({ data: keepaliveMocks.state.sloRows, error: keepaliveMocks.state.sloError }),
          }
          return { select: () => query }
        }
        if (table === "system_runs") {
          const query = {
            eq: () => query,
            order: () => query,
            limit: () => query,
            maybeSingle: async () => ({
              data: keepaliveMocks.state.previousRunDetails
                ? { details: keepaliveMocks.state.previousRunDetails }
                : null,
              error: keepaliveMocks.state.previousRunError,
            }),
          }
          return { select: () => query, insert: keepaliveMocks.insertRun }
        }
        throw new Error(`Unexpected keepalive table: ${table}`)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test("rejects callers without the cron bearer secret", async () => {
    const response = await GET(request("wrong-secret"))

    expect(response.status).toBe(401)
    expect(keepaliveMocks.createClient).not.toHaveBeenCalled()
  })

  test("runs retention and persists its result with the keepalive", async () => {
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.retention).toEqual({ shares: 1, systemRuns: 2, scrapeJobs: 3, notificationDeliveries: 0 })
    expect(keepaliveMocks.rpc).toHaveBeenCalledWith("cleanup_talon_retention")
    expect(keepaliveMocks.insertRun).toHaveBeenCalledWith(expect.objectContaining({
      kind: "keepalive",
      status: "success",
      details: expect.objectContaining({
        source: "vercel_cron",
        retention: { shares: 1, systemRuns: 2, scrapeJobs: 3, notificationDeliveries: 0 },
        sloMonitor: expect.objectContaining({
          state: "insufficient_data",
          notification: "unchanged",
        }),
      }),
    }))
  })

  test("fails visibly when retention cannot run", async () => {
    keepaliveMocks.rpc.mockResolvedValue({ data: null, error: new Error("function missing") })

    const response = await GET(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Supabase retention cleanup failed" })
    expect(keepaliveMocks.insertRun).not.toHaveBeenCalled()
  })

  test("fails visibly when notification retention cannot run", async () => {
    keepaliveMocks.rpc.mockImplementation(async (name: string) => name === "cleanup_notification_delivery_retention"
      ? { data: null, error: new Error("notification cleanup missing") }
      : { data: { shares: 1 }, error: null })

    const response = await GET(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Notification retention cleanup failed" })
    expect(keepaliveMocks.insertRun).not.toHaveBeenCalled()
  })

  test("sends and persists an aggregate Slack alert for a new SLO breach", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/test/webhook/value")
    keepaliveMocks.state.sloRows = [
      { status: "completed", started_at: "2026-08-13T00:00:00Z", completed_at: "2026-08-13T00:01:00Z" },
      { status: "completed", started_at: "2026-08-12T00:00:00Z", completed_at: "2026-08-12T00:01:00Z" },
      { status: "completed", started_at: "2026-08-11T00:00:00Z", completed_at: "2026-08-11T00:01:00Z" },
      { status: "completed", started_at: "2026-08-10T00:00:00Z", completed_at: "2026-08-10T00:01:00Z" },
      { status: "failed", started_at: "2026-08-09T00:00:00Z", completed_at: "2026-08-09T00:01:00Z" },
    ]

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.sloMonitor).toMatchObject({
      state: "breached",
      successRate: 80,
      notification: "sent",
      lastNotifiedFingerprint: "reliability:breached;latency:insufficient",
    })
    expect(keepaliveMocks.fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/test/webhook/value",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("80%"),
      })
    )
    expect(JSON.stringify(keepaliveMocks.fetch.mock.calls)).not.toMatch(/octocat|contributor/i)
  })

  test("records a failed notification without failing keepalive", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/test/webhook/value")
    keepaliveMocks.state.sloRows = Array.from({ length: 5 }, (_, index) => ({
      status: "completed" as const,
      started_at: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      completed_at: `2026-08-${String(index + 1).padStart(2, "0")}T00:05:00Z`,
    }))
    keepaliveMocks.fetch.mockResolvedValue({ ok: false, status: 503 })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.sloMonitor).toMatchObject({ state: "breached", notification: "failed" })
    expect(body.sloMonitor.lastNotifiedFingerprint).toBeNull()
  })
})
