import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const routeMocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  getAuthSession: vi.fn(),
  listActiveAuthSessions: vi.fn(),
  revokeAuthSessionById: vi.fn(),
  revokeOtherAuthSessions: vi.fn(),
  recordAuditEvent: vi.fn(),
}))

vi.mock("@/lib/permissions", () => ({ requirePermission: routeMocks.requirePermission }))
vi.mock("@/lib/auth", () => ({ getAuthSession: routeMocks.getAuthSession }))
vi.mock("@/lib/auth-sessions", () => ({
  listActiveAuthSessions: routeMocks.listActiveAuthSessions,
  revokeAuthSessionById: routeMocks.revokeAuthSessionById,
  revokeOtherAuthSessions: routeMocks.revokeOtherAuthSessions,
}))
vi.mock("@/lib/audit", () => ({ recordAuditEvent: routeMocks.recordAuditEvent }))

import { DELETE, GET } from "@/app/api/auth/sessions/route"

const currentSessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const otherSessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const session = {
  version: 3,
  sessionId: currentSessionId,
  issuedAt: 1,
  expiresAt: 9999999999,
  actor: "user",
  email: "recruiter@example.com",
  teamId: "team-1",
  teamSlug: "engineering",
  role: "recruiter",
}

function request(method: "GET" | "DELETE", body?: unknown) {
  return new NextRequest("https://talon.example/api/auth/sessions", {
    method,
    headers: method === "DELETE"
      ? { "Content-Type": "application/json", Origin: "https://talon.example" }
      : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe("active session routes", () => {
  beforeEach(() => {
    routeMocks.requirePermission.mockResolvedValue(null)
    routeMocks.getAuthSession.mockReturnValue(session)
    routeMocks.listActiveAuthSessions.mockResolvedValue([
      { sessionId: currentSessionId, issuedAt: "2026-08-21T10:00:00Z", expiresAt: "2026-08-21T22:00:00Z" },
      { sessionId: otherSessionId, issuedAt: "2026-08-21T09:00:00Z", expiresAt: "2026-08-21T21:00:00Z" },
    ])
    routeMocks.revokeAuthSessionById.mockResolvedValue(true)
    routeMocks.revokeOtherAuthSessions.mockResolvedValue(1)
  })

  test("lists only subject-scoped sessions and marks the current browser", async () => {
    const response = await GET(request("GET"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(routeMocks.listActiveAuthSessions).toHaveBeenCalledWith(session)
    expect(body.sessions).toEqual([
      expect.objectContaining({ sessionId: currentSessionId, current: true }),
      expect.objectContaining({ sessionId: otherSessionId, current: false }),
    ])
  })

  test("always includes the verified current browser when the bounded list is full", async () => {
    routeMocks.listActiveAuthSessions.mockResolvedValue([
      { sessionId: otherSessionId, issuedAt: "2026-08-21T09:00:00Z", expiresAt: "2026-08-21T21:00:00Z" },
    ])

    const response = await GET(request("GET"))
    const body = await response.json()

    expect(body.sessions[0]).toEqual(expect.objectContaining({
      sessionId: currentSessionId,
      current: true,
    }))
  })

  test("revokes one selected non-current session", async () => {
    const response = await DELETE(request("DELETE", { sessionId: otherSessionId }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, revoked: true })
    expect(routeMocks.revokeAuthSessionById).toHaveBeenCalledWith(session, otherSessionId)
    expect(routeMocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "auth.session_revoke",
      outcome: "success",
      metadata: { scope: "selected", revoked: true },
    }))
  })

  test("revokes every other session without ending the current browser", async () => {
    const response = await DELETE(request("DELETE", { scope: "others" }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, revokedCount: 1 })
    expect(routeMocks.revokeOtherAuthSessions).toHaveBeenCalledWith(session)
  })

  test("requires the normal logout path for the current session", async () => {
    const response = await DELETE(request("DELETE", { sessionId: currentSessionId }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: "Use Sign Out to end the current session." })
    expect(routeMocks.revokeAuthSessionById).not.toHaveBeenCalled()
  })

  test("rejects malformed session identifiers before touching the registry", async () => {
    const response = await DELETE(request("DELETE", { sessionId: "not-a-session" }))

    expect(response.status).toBe(400)
    expect(routeMocks.revokeAuthSessionById).not.toHaveBeenCalled()
  })

  test("fails closed when the session registry is unavailable", async () => {
    routeMocks.listActiveAuthSessions.mockRejectedValue(new Error("database unavailable"))

    const response = await GET(request("GET"))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Could not load active sessions.",
      code: "auth_session_list_unavailable",
      requestId: expect.any(String),
    })
  })
})
