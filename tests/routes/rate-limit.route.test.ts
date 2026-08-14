import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const routeMocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getActiveGitHubCooldown: vi.fn(),
}))

vi.mock("@/lib/permissions", () => ({ requirePermission: routeMocks.requirePermission }))
vi.mock("@/lib/db", () => ({ getActiveGitHubCooldown: routeMocks.getActiveGitHubCooldown }))

import { GET } from "@/app/api/rate-limit/route"

function rateLimitRequest(): import("next/server").NextRequest {
  return new Request("https://talon.example/api/rate-limit") as import("next/server").NextRequest
}

describe("GET /api/rate-limit", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_TOKEN", "github-test-token")
    routeMocks.requirePermission.mockReturnValue(null)
    routeMocks.getActiveGitHubCooldown.mockResolvedValue(null)
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      rate: { limit: 5000, remaining: 4500, reset: 1_786_594_800 },
    }), { status: 200 })))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test("returns current GitHub capacity when no cooldown is active", async () => {
    const response = await GET(rateLimitRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      limit: 5000,
      remaining: 4500,
      reset: 1_786_594_800,
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  test("reports automatic resume without making another GitHub request during cooldown", async () => {
    routeMocks.getActiveGitHubCooldown.mockResolvedValue({
      service: "github",
      blockedUntil: "2026-08-13T18:05:00.000Z",
      reason: "secondary-rate-limit",
    })

    const response = await GET(rateLimitRequest())

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      code: "github_cooldown",
      error: "GitHub checks are paused until 2026-08-13T18:05:00.000Z.",
      retryAt: "2026-08-13T18:05:00.000Z",
    })
    expect(fetch).not.toHaveBeenCalled()
  })
})
