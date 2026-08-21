import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const permissionMocks = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  getAuthSession: vi.fn(),
  getCurrentRequestMembership: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  getAuthSession: permissionMocks.getAuthSession,
}))

vi.mock("@/lib/session-authorization", () => ({
  requireActiveSession: permissionMocks.requireActiveSession,
}))

vi.mock("@/lib/request-membership", () => ({
  getCurrentRequestMembership: permissionMocks.getCurrentRequestMembership,
}))

import { requirePermission } from "@/lib/permissions"
import { type AuthRole } from "@/lib/auth-token"

const request = new NextRequest("https://talon.example/api/scrape", {
  method: "POST",
  headers: { Origin: "https://talon.example" },
})

function currentMembership(role: AuthRole) {
  return {
    email: "recruiter@example.com",
    role,
    workspaceRole: role,
    teamId: "team-1",
    teamSlug: "engineering",
  }
}

describe("live request authorization", () => {
  beforeEach(() => {
    permissionMocks.requireActiveSession.mockResolvedValue(null)
    permissionMocks.getAuthSession.mockReturnValue({
      version: 1,
      actor: "user",
      email: "recruiter@example.com",
      teamId: "team-1",
      teamSlug: "engineering",
      role: "owner",
      expiresAt: 9999999999,
    })
    permissionMocks.getCurrentRequestMembership.mockResolvedValue(currentMembership("owner"))
  })

  test.each([
    ["owner", "read", true],
    ["owner", "write", true],
    ["owner", "admin", true],
    ["owner", "manage_members", true],
    ["admin", "read", true],
    ["admin", "write", true],
    ["admin", "admin", true],
    ["admin", "manage_members", false],
    ["recruiter", "read", true],
    ["recruiter", "write", true],
    ["recruiter", "admin", false],
    ["recruiter", "manage_members", false],
    ["viewer", "read", true],
    ["viewer", "write", false],
    ["viewer", "admin", false],
    ["viewer", "manage_members", false],
  ] as const)("uses current %s membership for %s access", async (role, permission, allowed) => {
    permissionMocks.getCurrentRequestMembership.mockResolvedValue(currentMembership(role))

    const response = await requirePermission(request, permission)

    expect(response?.status ?? 200).toBe(allowed ? 200 : 403)
  })

  test("ignores an owner role stored in the cookie after the member is downgraded", async () => {
    permissionMocks.getCurrentRequestMembership.mockResolvedValue(currentMembership("viewer"))

    const response = await requirePermission(request, "write")

    expect(response?.status).toBe(403)
  })

  test("grants an upgraded role on the next request without requiring a new login", async () => {
    permissionMocks.getAuthSession.mockReturnValue({
      version: 1,
      actor: "user",
      email: "recruiter@example.com",
      teamId: "team-1",
      teamSlug: "engineering",
      role: "viewer",
      expiresAt: 9999999999,
    })
    permissionMocks.getCurrentRequestMembership.mockResolvedValue(currentMembership("admin"))

    expect(await requirePermission(request, "admin")).toBeNull()
  })

  test("denies a removed member immediately", async () => {
    permissionMocks.getCurrentRequestMembership.mockResolvedValue(null)

    const response = await requirePermission(request, "read")

    expect(response?.status).toBe(403)
  })

  test("keeps break-glass admin access independent of team membership", async () => {
    permissionMocks.getAuthSession.mockReturnValue({
      version: 1,
      actor: "admin",
      expiresAt: 9999999999,
    })

    expect(await requirePermission(request, "admin")).toBeNull()
    expect(await requirePermission(request, "manage_members")).toBeNull()
    expect(permissionMocks.getCurrentRequestMembership).not.toHaveBeenCalled()
  })

  test("fails closed when current membership cannot be checked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    permissionMocks.getCurrentRequestMembership.mockRejectedValue(new Error("database unavailable"))

    const response = await requirePermission(request, "write")

    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toEqual({ error: "Authorization could not be verified" })
  })

  test("rejects an authenticated cross-site mutation before reading membership", async () => {
    const crossSiteRequest = new NextRequest("https://talon.example/api/scrape", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Sec-Fetch-Site": "cross-site",
      },
    })

    const response = await requirePermission(crossSiteRequest, "write")

    expect(response?.status).toBe(403)
    await expect(response?.json()).resolves.toEqual({ error: "Cross-site request rejected" })
    expect(permissionMocks.getCurrentRequestMembership).not.toHaveBeenCalled()
  })

  test("allows a same-origin mutation to continue through live authorization", async () => {
    const sameOriginRequest = new NextRequest("https://talon.example/api/scrape", {
      method: "POST",
      headers: {
        Origin: "https://talon.example",
        "Sec-Fetch-Site": "same-origin",
      },
    })

    expect(await requirePermission(sameOriginRequest, "write")).toBeNull()
    expect(permissionMocks.getCurrentRequestMembership).toHaveBeenCalledOnce()
  })
})
