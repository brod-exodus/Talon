import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const auditMocks = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
  hasCronSecret: vi.fn(),
  insert: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  getAuthSession: auditMocks.getAuthSession,
  hasCronSecret: auditMocks.hasCronSecret,
}))

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({ insert: auditMocks.insert })),
  },
}))

vi.mock("@/lib/request-id", () => ({
  getRequestId: vi.fn(() => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
}))

vi.mock("@/lib/logger", () => ({
  logWarn: vi.fn(),
  sanitizeOperationalError: vi.fn((error) => error),
}))

import { recordAuditEvent } from "@/lib/audit"

describe("audit actor persistence", () => {
  beforeEach(() => {
    auditMocks.getAuthSession.mockReset()
    auditMocks.hasCronSecret.mockReset()
    auditMocks.insert.mockReset().mockResolvedValue({ error: null })
    auditMocks.hasCronSecret.mockReturnValue(false)
  })

  test("team-user events include a private correlation hash without storing the email", async () => {
    auditMocks.getAuthSession.mockReturnValue({
      actor: "user",
      email: "person@example.com",
    })

    await recordAuditEvent({
      request: new NextRequest("https://talon.example/api/share"),
      action: "share.create",
      outcome: "success",
      teamId: "team-1",
      metadata: { shareId: "share-1" },
    })

    expect(auditMocks.insert).toHaveBeenCalledOnce()
    const persisted = auditMocks.insert.mock.calls[0][0]
    expect(persisted.actor).toBe("user")
    expect(persisted.metadata).toEqual({
      shareId: "share-1",
      actorEmailHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(persisted)).not.toContain("person@example.com")
  })

  test("authenticated scheduler requests are recorded as cron", async () => {
    auditMocks.getAuthSession.mockReturnValue(null)
    auditMocks.hasCronSecret.mockReturnValue(true)

    await recordAuditEvent({
      request: new NextRequest("https://talon.example/api/scrape-jobs/run"),
      action: "scrape_worker.run",
      outcome: "success",
    })

    expect(auditMocks.insert).toHaveBeenCalledWith(expect.objectContaining({ actor: "cron" }))
  })
})
