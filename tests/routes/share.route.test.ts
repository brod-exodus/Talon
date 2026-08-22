import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest } from "next/server"

const shareMocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  resolveTeamContext: vi.fn(),
  teamContextError: vi.fn(),
  createSharedScrape: vi.fn(),
  listSharedScrapeLinks: vi.fn(),
  revokeSharedScrapeLink: vi.fn(),
  getSharedScrape: vi.fn(),
  recordAuditEvent: vi.fn(),
}))

vi.mock("@/lib/permissions", () => ({ requirePermission: shareMocks.requirePermission }))
vi.mock("@/lib/team-context", () => ({
  resolveTeamContext: shareMocks.resolveTeamContext,
  teamContextError: shareMocks.teamContextError,
}))
vi.mock("@/lib/db", () => ({
  createSharedScrape: shareMocks.createSharedScrape,
  listSharedScrapeLinks: shareMocks.listSharedScrapeLinks,
  revokeSharedScrapeLink: shareMocks.revokeSharedScrapeLink,
  getSharedScrape: shareMocks.getSharedScrape,
}))
vi.mock("@/lib/audit", () => ({ recordAuditEvent: shareMocks.recordAuditEvent }))

import { DELETE, GET, POST } from "@/app/api/share/route"
import { GET as GET_PUBLIC_SHARE } from "@/app/api/share/[token]/route"

const shareId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const share = {
  id: shareId,
  scrapeId: "scrape-123456",
  createdAt: "2026-08-13T12:00:00Z",
  expiresAt: "2026-08-20T12:00:00Z",
  revokedAt: null,
  allowDownload: false,
  lastAccessedAt: null,
  accessCount: 0,
}

function request(path = "/api/share", init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(`https://talon.example${path}`, init)
}

describe("share lifecycle routes", () => {
  beforeEach(() => {
    shareMocks.requirePermission.mockResolvedValue(null)
    shareMocks.resolveTeamContext.mockResolvedValue({
      teamId: "team-1",
      teamSlug: "engineering",
      actor: "user",
    })
    shareMocks.createSharedScrape.mockResolvedValue(share)
    shareMocks.listSharedScrapeLinks.mockResolvedValue([share])
    shareMocks.revokeSharedScrapeLink.mockResolvedValue({ ...share, revokedAt: "2026-08-13T13:00:00Z" })
  })

  test("creates a seven-day view-only link by default without returning its stored hash as the bearer token", async () => {
    const response = await POST(request("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scrapeId: "scrape-123456" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{24,128}$/)
    expect(body.token).not.toBe(shareId)
    expect(body.share).toEqual(share)
    expect(shareMocks.createSharedScrape).toHaveBeenCalledWith(
      "scrape-123456",
      body.token,
      expect.objectContaining({ allowDownload: false, expiresAt: expect.any(String) }),
      "team-1"
    )
  })

  test("rejects unsupported expiration periods", async () => {
    const response = await POST(request("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scrapeId: "scrape-123456", expiresInDays: 365 }),
    }))

    expect(response.status).toBe(400)
    expect(shareMocks.createSharedScrape).not.toHaveBeenCalled()
  })

  test("preserves a safe not-found response when the requested scrape is unavailable", async () => {
    shareMocks.createSharedScrape.mockRejectedValue(new Error("Scrape not found"))

    const response = await POST(request("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scrapeId: "scrape-123456" }),
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: "Scrape not found" })
  })

  test("does not expose database errors while creating a share", async () => {
    shareMocks.createSharedScrape.mockRejectedValue(
      new Error("password=database-secret relation public.shared_scrapes is unavailable")
    )

    const response = await POST(request("/api/share", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      },
      body: JSON.stringify({ scrapeId: "scrape-123456" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error: "Failed to create share",
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    })
    expect(JSON.stringify(body)).not.toContain("database-secret")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })

  test("lists lifecycle metadata for one team-owned scrape", async () => {
    const response = await GET(request("/api/share?scrapeId=scrape-123456"))

    await expect(response.json()).resolves.toEqual({ shares: [share] })
    expect(shareMocks.listSharedScrapeLinks).toHaveBeenCalledWith("scrape-123456", "team-1")
  })

  test("revokes an active share and audits the action", async () => {
    const response = await DELETE(request("/api/share", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shareId }),
    }))

    expect(response.status).toBe(200)
    expect(shareMocks.revokeSharedScrapeLink).toHaveBeenCalledWith(shareId, "team-1")
    expect(shareMocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "share.revoke" }))
  })

  test("public responses contain only sanitized fields and lifecycle permissions", async () => {
    shareMocks.getSharedScrape.mockResolvedValue({
      status: "active",
      expiresAt: share.expiresAt,
      allowDownload: true,
      scrape: {
        id: "scrape-123456",
        type: "repository",
        target: "octocat/Hello-World",
        status: "completed",
        progress: 100,
        current: 1,
        total: 1,
        startedAt: share.createdAt,
        contributors: [{
          id: "contributor-1",
          username: "octocat",
          name: "Octocat",
          avatar: "",
          contributions: 5,
          contacts: { email: "public@example.com" },
          contacted: true,
          contactedDate: "2026-08-01",
          notes: "private note",
          status: "interviewing",
        }],
      },
    })

    const response = await GET_PUBLIC_SHARE(request("/api/share/public-token-value-123456"), {
      params: Promise.resolve({ token: "public-token-value-123456" }),
    })
    const body = await response.json()
    const serialized = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body.share.allowDownload).toBe(true)
    expect(serialized).not.toContain("private note")
    expect(serialized).not.toContain("interviewing")
    expect(response.headers.get("cache-control")).toContain("no-store")
  })

  test.each(["expired", "revoked"] as const)("returns 410 for a %s share", async (status) => {
    shareMocks.getSharedScrape.mockResolvedValue({ status })

    const response = await GET_PUBLIC_SHARE(request("/api/share/public-token-value-123456"), {
      params: Promise.resolve({ token: "public-token-value-123456" }),
    })

    expect(response.status).toBe(410)
  })

  test("does not expose database errors from the public share route", async () => {
    shareMocks.getSharedScrape.mockRejectedValue(
      new Error("token public-token-value-123456 failed in public.shared_scrapes")
    )

    const response = await GET_PUBLIC_SHARE(request("/api/share/public-token-value-123456", {
      headers: { "X-Request-ID": "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    }), {
      params: Promise.resolve({ token: "public-token-value-123456" }),
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error: "Failed to fetch share",
      requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    })
    expect(JSON.stringify(body)).not.toContain("public-token-value")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
  })
})
