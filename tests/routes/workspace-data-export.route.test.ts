import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const exportMocks = vi.hoisted(() => ({
  requirePermission: vi.fn(), resolveTeamContext: vi.fn(), teamContextError: vi.fn(),
  rpc: vi.fn(), recordAuditEvent: vi.fn(), logError: vi.fn(), serializeWorkspaceExport: vi.fn(),
}))

vi.mock("@/lib/permissions", () => ({ requirePermission: exportMocks.requirePermission }))
vi.mock("@/lib/team-context", () => ({
  resolveTeamContext: exportMocks.resolveTeamContext,
  teamContextError: exportMocks.teamContextError,
}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { rpc: exportMocks.rpc } }))
vi.mock("@/lib/audit", () => ({ recordAuditEvent: exportMocks.recordAuditEvent }))
vi.mock("@/lib/logger", () => ({ logError: exportMocks.logError }))
vi.mock("@/lib/workspace-export", () => ({
  MAX_IMMEDIATE_WORKSPACE_EXPORT_BYTES: 4 * 1024 * 1024,
  serializeWorkspaceExport: exportMocks.serializeWorkspaceExport,
}))

import { POST } from "@/app/api/workspace-lifecycle/export/route"

function request(origin = "https://talon.example") {
  return new NextRequest("https://talon.example/api/workspace-lifecycle/export", {
    method: "POST", headers: { Origin: origin },
  })
}

describe("owner-only workspace export", () => {
  beforeEach(() => {
    exportMocks.requirePermission.mockResolvedValue(null)
    exportMocks.resolveTeamContext.mockResolvedValue({ teamId: "team-1", role: "owner" })
    exportMocks.rpc.mockResolvedValue({ data: { safe: true }, error: null })
    exportMocks.serializeWorkspaceExport.mockReturnValue({ body: "{\"safe\":true}\n", bytes: 14 })
    exportMocks.recordAuditEvent.mockResolvedValue(undefined)
  })

  test("requires live owner permission before reading export data", async () => {
    const denied = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    exportMocks.requirePermission.mockResolvedValue(denied)
    const response = await POST(request())
    expect(response).toBe(denied)
    expect(exportMocks.rpc).not.toHaveBeenCalled()
  })

  test("downloads a non-cached workspace-scoped JSON export and audits it", async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="talon-workspace-export-\d{4}-\d{2}-\d{2}\.json"$/)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(exportMocks.rpc).toHaveBeenCalledWith("export_workspace_data", { p_team_id: "team-1" })
    expect(exportMocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "workspace.export", outcome: "success", teamId: "team-1",
      metadata: { formatVersion: 1, bytes: 14 },
    }))
  })

  test("fails instead of returning a partial oversized export", async () => {
    exportMocks.serializeWorkspaceExport.mockReturnValue({ body: "", bytes: 4 * 1024 * 1024 + 1 })
    const response = await POST(request())
    expect(response.status).toBe(413)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(exportMocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "blocked", teamId: "team-1",
    }))
  })

  test("sanitizes database and serialization failures", async () => {
    exportMocks.rpc.mockResolvedValue({ data: null, error: new Error("private database detail") })
    const response = await POST(request())
    const serialized = JSON.stringify(await response.json())
    expect(response.status).toBe(500)
    expect(serialized).toContain("Failed to export workspace data")
    expect(serialized).not.toContain("private database detail")
    expect(exportMocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failure" }))
  })
})
