import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const keepaliveMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  insertRun: vi.fn(),
  rpc: vi.fn(),
  state: {
    databaseError: null as Error | null,
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
    keepaliveMocks.state.databaseError = null
    keepaliveMocks.rpc.mockResolvedValue({
      data: { shares: 1, systemRuns: 2, scrapeJobs: 3 },
      error: null,
    })
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
        if (table === "system_runs") return { insert: keepaliveMocks.insertRun }
        throw new Error(`Unexpected keepalive table: ${table}`)
      },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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
    expect(body.retention).toEqual({ shares: 1, systemRuns: 2, scrapeJobs: 3 })
    expect(keepaliveMocks.rpc).toHaveBeenCalledWith("cleanup_talon_retention")
    expect(keepaliveMocks.insertRun).toHaveBeenCalledWith(expect.objectContaining({
      kind: "keepalive",
      status: "success",
      details: {
        source: "vercel_cron",
        retention: { shares: 1, systemRuns: 2, scrapeJobs: 3 },
      },
    }))
  })

  test("fails visibly when retention cannot run", async () => {
    keepaliveMocks.rpc.mockResolvedValue({ data: null, error: new Error("function missing") })

    const response = await GET(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: "Supabase retention cleanup failed" })
    expect(keepaliveMocks.insertRun).not.toHaveBeenCalled()
  })
})
