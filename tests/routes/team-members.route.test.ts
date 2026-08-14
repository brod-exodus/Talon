import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const teamMemberMocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  resolveTeamContext: vi.fn(),
  teamContextError: vi.fn(),
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  listUsers: vi.fn(),
  recordAuditEvent: vi.fn(),
}))

vi.mock("@/lib/permissions", () => ({ requirePermission: teamMemberMocks.requirePermission }))
vi.mock("@/lib/team-context", () => ({
  resolveTeamContext: teamMemberMocks.resolveTeamContext,
  teamContextError: teamMemberMocks.teamContextError,
}))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    rpc: teamMemberMocks.rpc,
    auth: { admin: { listUsers: teamMemberMocks.listUsers } },
  },
}))
vi.mock("@/lib/audit", () => ({
  hashAuditValue: (value: string) => `hash:${value}`,
  recordAuditEvent: teamMemberMocks.recordAuditEvent,
}))

import { DELETE, PATCH } from "@/app/api/team-members/[id]/route"

const memberId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const member = {
  id: memberId,
  team_id: "team-1",
  email: "owner@example.com",
  display_name: "Owner",
  role: "owner",
  app_role: "owner",
  invited_by: null,
  created_at: "2026-08-14T12:00:00Z",
}

function request(method: "PATCH" | "DELETE", body?: Record<string, unknown>) {
  return new NextRequest(`https://talon.example/api/team-members/${memberId}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: "https://talon.example" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const context = { params: Promise.resolve({ id: memberId }) }

describe("owner-only team member mutations", () => {
  beforeEach(() => {
    teamMemberMocks.requirePermission.mockResolvedValue(null)
    teamMemberMocks.resolveTeamContext.mockResolvedValue({
      actor: "user",
      teamId: "team-1",
      teamSlug: "engineering",
    })
    teamMemberMocks.rpc.mockReturnValue({ maybeSingle: teamMemberMocks.maybeSingle })
    teamMemberMocks.maybeSingle.mockResolvedValue({ data: member, error: null })
    teamMemberMocks.listUsers.mockResolvedValue({ data: { users: [] }, error: null })
  })

  test("requires the membership-management permission before changing a role", async () => {
    const denied = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    teamMemberMocks.requirePermission.mockResolvedValue(denied)

    const response = await PATCH(request("PATCH", { role: "admin" }), context)

    expect(response).toBe(denied)
    expect(teamMemberMocks.requirePermission).toHaveBeenCalledWith(expect.any(NextRequest), "manage_members")
    expect(teamMemberMocks.rpc).not.toHaveBeenCalled()
  })

  test("updates roles through the team-scoped atomic function", async () => {
    const response = await PATCH(request("PATCH", { role: "admin" }), context)

    expect(response.status).toBe(200)
    expect(teamMemberMocks.rpc).toHaveBeenCalledWith("update_team_member_app_role", {
      p_team_id: "team-1",
      p_member_id: memberId,
      p_app_role: "admin",
    })
  })

  test.each([
    ["PATCH", "admin", PATCH],
    ["DELETE", undefined, DELETE],
  ] as const)("returns conflict when %s would remove the final owner", async (method, role, handler) => {
    teamMemberMocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "At least one owner must remain on the team" },
    })

    const response = await handler(
      request(method, role ? { role } : undefined),
      context
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: "At least one owner must remain on the team" })
    expect(teamMemberMocks.recordAuditEvent).not.toHaveBeenCalled()
  })

  test("removes a member through the team-scoped atomic function", async () => {
    const response = await DELETE(request("DELETE"), context)

    expect(response.status).toBe(200)
    expect(teamMemberMocks.rpc).toHaveBeenCalledWith("remove_team_member", {
      p_team_id: "team-1",
      p_member_id: memberId,
    })
    expect(teamMemberMocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "team.member.remove",
    }))
  })
})
