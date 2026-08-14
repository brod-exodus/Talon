import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const authMeMocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  roleHasPermission: vi.fn(),
  resolveTeamContext: vi.fn(),
  teamContextError: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock("@/lib/permissions", () => ({
  requirePermission: authMeMocks.requirePermission,
  roleHasPermission: authMeMocks.roleHasPermission,
}))

vi.mock("@/lib/team-context", () => ({
  resolveTeamContext: authMeMocks.resolveTeamContext,
  teamContextError: authMeMocks.teamContextError,
}))

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: authMeMocks.maybeSingle })),
        })),
      })),
    })),
  },
}))

import { GET } from "@/app/api/auth/me/route"

const permissionMatrix = {
  owner: new Set(["read", "write", "admin", "manage_members"]),
  admin: new Set(["read", "write", "admin"]),
  recruiter: new Set(["read", "write"]),
  viewer: new Set(["read"]),
} as const

describe("current live permissions", () => {
  beforeEach(() => {
    authMeMocks.requirePermission.mockResolvedValue(null)
    authMeMocks.maybeSingle.mockResolvedValue({
      data: { display_name: "Recruiter", avatar_url: null },
      error: null,
    })
    authMeMocks.roleHasPermission.mockImplementation(
      (role: keyof typeof permissionMatrix, permission: string) => permissionMatrix[role].has(permission as never)
    )
  })

  test.each([
    ["owner", true, true],
    ["admin", true, false],
    ["recruiter", false, false],
    ["viewer", false, false],
  ] as const)("returns live %s administration permissions", async (role, canAdmin, canManageMembers) => {
    authMeMocks.resolveTeamContext.mockResolvedValue({
      actor: "user",
      email: "recruiter@example.com",
      role,
      teamId: "team-1",
      teamSlug: "engineering",
    })

    const response = await GET(new NextRequest("https://talon.example/api/auth/me"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.permissions.canAdmin).toBe(canAdmin)
    expect(body.permissions.canManageMembers).toBe(canManageMembers)
  })

  test("keeps break-glass admin capable of member recovery", async () => {
    authMeMocks.resolveTeamContext.mockResolvedValue({
      actor: "admin",
      teamId: "team-default",
      teamSlug: "default",
    })

    const response = await GET(new NextRequest("https://talon.example/api/auth/me"))
    const body = await response.json()

    expect(body.permissions).toEqual({
      canRead: true,
      canWrite: true,
      canAdmin: true,
      canManageMembers: true,
    })
    expect(authMeMocks.roleHasPermission).not.toHaveBeenCalled()
  })
})
