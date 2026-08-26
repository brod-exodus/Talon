import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const mocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  recordRequest: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUserById: vi.fn(),
  membership: vi.fn(),
  revokeSessions: vi.fn(),
  audit: vi.fn(),
  logError: vi.fn(),
}))

vi.mock("@/lib/login-rate-limit", () => ({
  checkPasswordResetRateLimit: mocks.checkRateLimit,
  recordPasswordResetRequest: mocks.recordRequest,
}))
vi.mock("@/lib/supabase", () => ({
  createSupabaseAuthClient: () => ({ auth: {
    resetPasswordForEmail: mocks.resetPasswordForEmail,
    verifyOtp: mocks.verifyOtp,
  } }),
  supabaseAdmin: { auth: { admin: { updateUserById: mocks.updateUserById } } },
}))
vi.mock("@/lib/team-membership", () => ({ getPrimaryTeamMembershipForEmail: mocks.membership }))
vi.mock("@/lib/auth-sessions", () => ({ revokeAllAuthSessionsForIdentity: mocks.revokeSessions }))
vi.mock("@/lib/audit", () => ({ hashAuditValue: (value: string) => `hash:${value}`, recordAuditEvent: mocks.audit }))
vi.mock("@/lib/logger", () => ({ logError: mocks.logError }))

import { POST as requestReset } from "@/app/api/auth/password/reset-request/route"
import { POST as completeReset } from "@/app/api/auth/password/reset/route"

function request(path: string, body: Record<string, unknown>, origin = "https://talon.example") {
  return new NextRequest(`https://talon.example${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": origin === "https://talon.example" ? "same-origin" : "cross-site",
    },
    body: JSON.stringify(body),
  })
}

describe("password recovery routes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.checkRateLimit.mockResolvedValue({ allowed: true })
    mocks.recordRequest.mockResolvedValue(undefined)
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null })
    mocks.verifyOtp.mockResolvedValue({
      data: { user: { id: "user-1", email: "Recruiter@Example.com" } },
      error: null,
    })
    mocks.membership.mockResolvedValue({
      email: "recruiter@example.com",
      teamId: "team-1",
      teamSlug: "engineering",
      role: "recruiter",
    })
    mocks.revokeSessions.mockResolvedValue(undefined)
    mocks.updateUserById.mockResolvedValue({ error: null })
  })

  test("reset requests are non-enumerating and use Talon's fixed recovery page", async () => {
    const known = await requestReset(request("/api/auth/password/reset-request", { email: "Recruiter@Example.com" }))
    const knownBody = await known.json()
    mocks.resetPasswordForEmail.mockResolvedValueOnce({ error: new Error("unknown user") })
    const unknown = await requestReset(request("/api/auth/password/reset-request", { email: "nobody@example.com" }))

    expect(known.status).toBe(200)
    await expect(unknown.json()).resolves.toEqual(knownBody)
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("recruiter@example.com", {
      redirectTo: "https://talon.example/reset-password",
    })
    expect(mocks.recordRequest).toHaveBeenCalledTimes(2)
  })

  test("reset requests reject cross-site submissions before email delivery", async () => {
    const response = await requestReset(request("/api/auth/password/reset-request", { email: "user@example.com" }, "https://attacker.example"))
    expect(response.status).toBe(403)
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  test("reset completion verifies the one-time token, revokes sessions, then changes the password", async () => {
    const response = await completeReset(request("/api/auth/password/reset", {
      tokenHash: "a".repeat(64),
      password: "new-secure-password",
    }))

    expect(response.status).toBe(200)
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "a".repeat(64), type: "recovery" })
    expect(mocks.revokeSessions).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-1" }), "password_change")
    expect(mocks.updateUserById).toHaveBeenCalledWith("user-1", { password: "new-secure-password" })
    expect(mocks.revokeSessions.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateUserById.mock.invocationCallOrder[0])
  })

  test("an invalid or used token reveals no account details", async () => {
    mocks.verifyOtp.mockResolvedValue({ data: { user: null }, error: new Error("expired") })
    const response = await completeReset(request("/api/auth/password/reset", {
      tokenHash: "a".repeat(64),
      password: "new-secure-password",
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "This password reset link is invalid or has expired. Request a new link and try again.",
    })
    expect(mocks.updateUserById).not.toHaveBeenCalled()
  })

  test("a session-revocation failure prevents the password change", async () => {
    mocks.revokeSessions.mockRejectedValue(new Error("database unavailable"))
    const response = await completeReset(request("/api/auth/password/reset", {
      tokenHash: "a".repeat(64),
      password: "new-secure-password",
    }))

    expect(response.status).toBe(503)
    expect(mocks.updateUserById).not.toHaveBeenCalled()
    expect(mocks.logError).toHaveBeenCalledWith(
      "auth.password_reset_session_revoke_failed",
      expect.any(Error),
      expect.objectContaining({ teamId: "team-1" })
    )
  })
})
