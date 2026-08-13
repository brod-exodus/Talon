import { beforeEach, describe, expect, test, vi } from "vitest"

const membershipMocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
  getTeamMembershipForSession: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ getAuthSession: membershipMocks.getAuthSession }))
vi.mock("@/lib/team-membership", () => ({
  getTeamMembershipForSession: membershipMocks.getTeamMembershipForSession,
}))

import { getCurrentRequestMembership } from "@/lib/request-membership"

function request(path = "/api/scrape") {
  return new Request(`https://talon.example${path}`) as import("next/server").NextRequest
}

describe("request membership cache", () => {
  beforeEach(() => {
    membershipMocks.getAuthSession.mockReturnValue({
      version: 1,
      actor: "user",
      email: "recruiter@example.com",
      teamId: "team-1",
      teamSlug: "engineering",
      role: "recruiter",
      expiresAt: 9999999999,
    })
    membershipMocks.getTeamMembershipForSession.mockResolvedValue({
      email: "recruiter@example.com",
      role: "recruiter",
      workspaceRole: "recruiter",
      teamId: "team-1",
      teamSlug: "engineering",
    })
  })

  test("reuses the live membership within one request", async () => {
    const currentRequest = request()

    const first = await getCurrentRequestMembership(currentRequest)
    const second = await getCurrentRequestMembership(currentRequest)

    expect(second).toEqual(first)
    expect(membershipMocks.getTeamMembershipForSession).toHaveBeenCalledTimes(1)
  })

  test("loads membership again for the next request", async () => {
    await getCurrentRequestMembership(request("/api/scrape"))
    await getCurrentRequestMembership(request("/api/scrapes"))

    expect(membershipMocks.getTeamMembershipForSession).toHaveBeenCalledTimes(2)
  })

  test("does not query team membership for break-glass admin sessions", async () => {
    membershipMocks.getAuthSession.mockReturnValue({
      version: 1,
      actor: "admin",
      expiresAt: 9999999999,
    })

    await expect(getCurrentRequestMembership(request())).resolves.toBeNull()
    expect(membershipMocks.getTeamMembershipForSession).not.toHaveBeenCalled()
  })
})
