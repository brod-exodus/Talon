import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const sessionMocks = vi.hoisted(() => ({
  isAuthSessionActive: vi.fn(),
}))

vi.mock("@/lib/auth-sessions", () => ({
  isAuthSessionActive: sessionMocks.isAuthSessionActive,
}))

import { createSessionToken } from "@/lib/auth-token"
import { requireActiveSession } from "@/lib/session-authorization"

function authenticatedRequest(token: string) {
  return new NextRequest("https://talon.example/api/scrapes", {
    headers: { Cookie: `talon_session=${token}` },
  })
}

describe("server-side session authorization", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("TALON_SESSION_SECRET", "test-session-secret-with-enough-length")
    vi.stubEnv("TALON_ADMIN_PASSWORD", "test-admin-password")
    sessionMocks.isAuthSessionActive.mockResolvedValue(true)
  })

  test("accepts a signed session only when its registry record is active", async () => {
    const token = createSessionToken()

    expect(await requireActiveSession(authenticatedRequest(token))).toBeNull()
    expect(sessionMocks.isAuthSessionActive).toHaveBeenCalledWith(expect.objectContaining({ actor: "admin" }))
  })

  test("rejects a valid cookie after its registry record is revoked", async () => {
    sessionMocks.isAuthSessionActive.mockResolvedValue(false)

    const response = await requireActiveSession(authenticatedRequest(createSessionToken()))

    expect(response?.status).toBe(401)
    await expect(response?.json()).resolves.toEqual({ error: "Session expired or revoked" })
  })

  test("fails closed when the registry cannot be checked", async () => {
    sessionMocks.isAuthSessionActive.mockRejectedValue(new Error("database unavailable"))

    const response = await requireActiveSession(authenticatedRequest(createSessionToken()))

    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toEqual({ error: "Session could not be verified" })
  })
})
