import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(), getAuthSession: vi.fn(), clearAuthCookie: vi.fn(),
  resolveTeamContext: vi.fn(), teamContextError: vi.fn(), rpc: vi.fn(), remove: vi.fn(),
  recordAuditEvent: vi.fn(), logError: vi.fn(),
  runStorageCleanupTask: vi.fn(),
}))

vi.mock("@/lib/permissions", () => ({ requirePermission: mocks.requirePermission }))
vi.mock("@/lib/auth", () => ({ getAuthSession: mocks.getAuthSession, clearAuthCookie: mocks.clearAuthCookie }))
vi.mock("@/lib/team-context", () => ({ resolveTeamContext: mocks.resolveTeamContext, teamContextError: mocks.teamContextError }))
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }))
vi.mock("@/lib/logger", () => ({ logError: mocks.logError }))
vi.mock("@/lib/storage-cleanup-worker", () => ({ runStorageCleanupTask: mocks.runStorageCleanupTask }))
vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}))

import { DELETE } from "@/app/api/workspace-lifecycle/delete/route"

function request(confirmation = "engineering") {
  return new NextRequest("https://talon.example/api/workspace-lifecycle/delete", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", Origin: "https://talon.example" },
    body: JSON.stringify({ confirmation }),
  })
}

describe("guarded workspace deletion", () => {
  beforeEach(() => {
    mocks.requirePermission.mockResolvedValue(null)
    mocks.getAuthSession.mockReturnValue({ actor: "user", email: "owner@example.com" })
    mocks.resolveTeamContext.mockResolvedValue({ actor: "user", teamId: "team-1", teamSlug: "engineering", role: "owner" })
    mocks.rpc.mockResolvedValue({
      data: { version: 1, receiptId: "12345678-1234-1234-1234-123456789abc", deletedAt: "2026-08-27T12:00:00Z", hasStorageCleanup: false },
      error: null,
    })
    mocks.runStorageCleanupTask.mockResolvedValue({ status: "succeeded", taskId: "task-1", recoveredStaleTasks: 0 })
    mocks.recordAuditEvent.mockResolvedValue(undefined)
  })

  test("requires live owner permission and a user session", async () => {
    const denied = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    mocks.requirePermission.mockResolvedValue(denied)
    expect(await DELETE(request())).toBe(denied)
    expect(mocks.rpc).not.toHaveBeenCalled()

    mocks.requirePermission.mockResolvedValue(null)
    mocks.getAuthSession.mockReturnValue({ actor: "admin" })
    expect((await DELETE(request())).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  test("blocks mismatched confirmation without calling the deletion function", async () => {
    const response = await DELETE(request("Engineering"))
    expect(response.status).toBe(400)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "blocked", teamId: "team-1" }))
  })

  test("deletes the live workspace, cleans profile photos, and clears the session", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        version: 1, receiptId: "12345678-1234-1234-1234-123456789abc",
        deletedAt: "2026-08-27T12:00:00Z", hasStorageCleanup: true,
      },
      error: null,
    })
    const response = await DELETE(request())
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith("delete_workspace_data", { p_team_id: "team-1", p_confirmation: "engineering" })
    expect(mocks.runStorageCleanupTask).toHaveBeenCalledWith("12345678-1234-1234-1234-123456789abc")
    expect(body).toEqual({
      success: true,
      receipt: { version: 1, receiptId: "12345678-1234-1234-1234-123456789abc", deletedAt: "2026-08-27T12:00:00Z" },
      profilePhotoCleanup: "complete",
    })
    expect(JSON.stringify(body)).not.toContain("avatar.png")
    expect(mocks.clearAuthCookie).toHaveBeenCalledWith(response)
  })

  test("queues retryable storage cleanup after committed database deletion", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        version: 1, receiptId: "12345678-1234-1234-1234-123456789abc",
        deletedAt: "2026-08-27T12:00:00Z", hasStorageCleanup: true,
      }, error: null,
    })
    mocks.runStorageCleanupTask.mockResolvedValue({ status: "queued", taskId: "task-1", recoveredStaleTasks: 0 })
    const response = await DELETE(request())
    expect(response.status).toBe(200)
    expect((await response.json()).profilePhotoCleanup).toBe("queued")
  })

  test("does not report a committed deletion as failed when immediate cleanup dispatch is unavailable", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        version: 1, receiptId: "12345678-1234-1234-1234-123456789abc",
        deletedAt: "2026-08-27T12:00:00Z", hasStorageCleanup: true,
      }, error: null,
    })
    mocks.runStorageCleanupTask.mockRejectedValue(new Error("private cleanup detail"))
    const response = await DELETE(request())
    expect(response.status).toBe(200)
    expect((await response.json()).profilePhotoCleanup).toBe("queued")
    expect(mocks.logError).toHaveBeenCalledWith("workspace.storage_cleanup_dispatch_failed", expect.any(Error), expect.anything())
  })

  test("returns a retryable conflict for active work and sanitizes other failures", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "55006", message: "private" } })
    const blocked = await DELETE(request())
    expect(blocked.status).toBe(409)
    expect(JSON.stringify(await blocked.json())).not.toContain("private")

    mocks.rpc.mockResolvedValue({ data: null, error: new Error("private database detail") })
    const failed = await DELETE(request())
    const serialized = JSON.stringify(await failed.json())
    expect(failed.status).toBe(500)
    expect(serialized).toContain("Failed to delete workspace data")
    expect(serialized).not.toContain("private database detail")
  })
})
