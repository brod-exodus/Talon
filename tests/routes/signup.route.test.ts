import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const signupMocks = vi.hoisted(() => ({
  checkLoginRateLimit: vi.fn(),
  recordLoginFailure: vi.fn(),
  resetLoginRateLimit: vi.fn(),
  createUser: vi.fn(),
  ensurePrivateWorkspaceForUser: vi.fn(),
  recordAuditEvent: vi.fn(),
  createSessionToken: vi.fn(),
  setAuthCookie: vi.fn(),
}))

vi.mock("@/lib/login-rate-limit", () => ({
  checkLoginRateLimit: signupMocks.checkLoginRateLimit,
  recordLoginFailure: signupMocks.recordLoginFailure,
  resetLoginRateLimit: signupMocks.resetLoginRateLimit,
}))

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    auth: { admin: { createUser: signupMocks.createUser } },
  },
}))

vi.mock("@/lib/team-membership", () => ({
  ensurePrivateWorkspaceForUser: signupMocks.ensurePrivateWorkspaceForUser,
}))

vi.mock("@/lib/audit", () => ({
  hashAuditValue: (value: string) => `hash:${value}`,
  recordAuditEvent: signupMocks.recordAuditEvent,
}))

vi.mock("@/lib/auth", () => ({
  createSessionToken: signupMocks.createSessionToken,
  setAuthCookie: signupMocks.setAuthCookie,
}))

import { POST } from "@/app/api/auth/signup/route"

function signupRequest(origin = "https://talon.example") {
  return new NextRequest("https://talon.example/api/auth/signup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": origin === "https://talon.example" ? "same-origin" : "cross-site",
    },
    body: JSON.stringify({
      email: "owner@example.com",
      displayName: "Owner",
      password: "correct-horse-battery-staple",
    }),
  })
}

describe("self-service signup policy", () => {
  beforeEach(() => {
    signupMocks.checkLoginRateLimit.mockResolvedValue({ allowed: true })
    signupMocks.createUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "owner@example.com" } },
      error: null,
    })
    signupMocks.ensurePrivateWorkspaceForUser.mockResolvedValue({
      email: "owner@example.com",
      teamId: "team-1",
      teamSlug: "owner",
      role: "owner",
    })
    signupMocks.createSessionToken.mockReturnValue("session-token")
    signupMocks.setAuthCookie.mockImplementation((response: NextResponse) => response)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test("rejects registration by default before consuming database or auth capacity", async () => {
    vi.stubEnv("TALON_SELF_SERVICE_SIGNUP_ENABLED", "false")

    const response = await POST(signupRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: "Self-service registration is disabled. Ask a Talon administrator to create your account.",
    })
    expect(signupMocks.checkLoginRateLimit).not.toHaveBeenCalled()
    expect(signupMocks.createUser).not.toHaveBeenCalled()
    expect(signupMocks.ensurePrivateWorkspaceForUser).not.toHaveBeenCalled()
  })

  test("allows the existing signup workflow only after explicit opt-in", async () => {
    vi.stubEnv("TALON_SELF_SERVICE_SIGNUP_ENABLED", "true")

    const response = await POST(signupRequest())

    expect(response.status).toBe(200)
    expect(signupMocks.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "owner@example.com",
      email_confirm: true,
    }))
    expect(signupMocks.ensurePrivateWorkspaceForUser).toHaveBeenCalledWith("owner@example.com", "Owner", "owner")
    expect(signupMocks.setAuthCookie).toHaveBeenCalledWith(expect.any(NextResponse), "session-token")
  })

  test("keeps the cross-site write boundary ahead of the registration setting", async () => {
    vi.stubEnv("TALON_SELF_SERVICE_SIGNUP_ENABLED", "true")

    const response = await POST(signupRequest("https://attacker.example"))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "Cross-site request rejected" })
    expect(signupMocks.checkLoginRateLimit).not.toHaveBeenCalled()
    expect(signupMocks.createUser).not.toHaveBeenCalled()
  })
})
