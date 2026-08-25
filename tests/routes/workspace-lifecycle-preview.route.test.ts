import { beforeEach, describe, expect, test, vi } from "vitest"
import { NextRequest, NextResponse } from "next/server"

const lifecycleMocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  resolveTeamContext: vi.fn(),
  teamContextError: vi.fn(),
  rpc: vi.fn(),
  logError: vi.fn(),
}))

vi.mock("@/lib/permissions", () => ({ requirePermission: lifecycleMocks.requirePermission }))
vi.mock("@/lib/team-context", () => ({
  resolveTeamContext: lifecycleMocks.resolveTeamContext,
  teamContextError: lifecycleMocks.teamContextError,
}))
vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { rpc: lifecycleMocks.rpc } }))
vi.mock("@/lib/logger", () => ({ logError: lifecycleMocks.logError }))

import { GET } from "@/app/api/workspace-lifecycle/preview/route"

const countKeys = [
  "members", "authSessions", "contributors", "scrapes", "scrapeContributors",
  "sharedScrapes", "projects", "projectScrapes", "projectCaches", "projectLists",
  "projectListContributors", "projectTracking", "watchedRepositories", "watchedContributors",
  "scrapeJobs", "scrapeJobContributions", "scrapeJobRepositoryContributions", "scrapeJobEvents",
  "scrapeEnqueueRequests", "notificationDeliveries", "activityEvents", "auditEvents",
]
const blockerKeys = [
  "activeScrapes", "activeScrapeJobs", "activeNotificationDeliveries",
  "activeSharedLinks", "activeAuthSessions",
]

function request() {
  return new NextRequest("https://talon.example/api/workspace-lifecycle/preview", {
    headers: { Origin: "https://talon.example" },
  })
}

function databasePreview() {
  return {
    version: 1,
    generatedAt: "2026-08-25T12:00:00.000Z",
    counts: Object.fromEntries(countKeys.map((key, index) => [key, index + 1])),
    blockers: Object.fromEntries(blockerKeys.map((key) => [key, 0])),
    hasActiveWork: false,
    ignoredSecret: "must-not-escape",
  }
}

describe("owner-only workspace lifecycle preview", () => {
  beforeEach(() => {
    lifecycleMocks.requirePermission.mockResolvedValue(null)
    lifecycleMocks.resolveTeamContext.mockResolvedValue({
      actor: "user",
      teamId: "team-1",
      teamSlug: "engineering",
      role: "owner",
    })
    lifecycleMocks.rpc.mockResolvedValue({ data: databasePreview(), error: null })
  })

  test("requires current owner permission before reading workspace counts", async () => {
    const denied = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    lifecycleMocks.requirePermission.mockResolvedValue(denied)

    const response = await GET(request())

    expect(response).toBe(denied)
    expect(lifecycleMocks.requirePermission).toHaveBeenCalledWith(expect.any(NextRequest), "manage_members")
    expect(lifecycleMocks.rpc).not.toHaveBeenCalled()
  })

  test("scopes the database preview to the live request workspace", async () => {
    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(lifecycleMocks.rpc).toHaveBeenCalledWith("preview_workspace_lifecycle", { p_team_id: "team-1" })
    expect(body.preview.counts.members).toBe(1)
    expect(body.preview.counts.auditEvents).toBe(22)
    expect(body.preview.externalData).toEqual({
      supabaseAuth: "not_counted",
      profilePhotoStorage: "not_counted",
      encryptedBackups: "not_counted",
      downloadedExports: "outside_talon_control",
    })
    expect(JSON.stringify(body)).not.toContain("must-not-escape")
    expect(JSON.stringify(body)).not.toContain("team-1")
  })

  test("rejects malformed database output instead of returning misleading counts", async () => {
    lifecycleMocks.rpc.mockResolvedValue({
      data: { ...databasePreview(), counts: { ...databasePreview().counts, contributors: -1 } },
      error: null,
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe("Failed to preview workspace data")
    expect(body.requestId).toBeTruthy()
    expect(lifecycleMocks.logError).toHaveBeenCalledOnce()
  })

  test("derives active work from validated blockers instead of trusting a summary flag", async () => {
    lifecycleMocks.rpc.mockResolvedValue({
      data: {
        ...databasePreview(),
        blockers: { ...databasePreview().blockers, activeScrapeJobs: 1 },
        hasActiveWork: false,
      },
      error: null,
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.preview.hasActiveWork).toBe(true)
  })

  test("returns a sanitized error when the preview function fails", async () => {
    lifecycleMocks.rpc.mockResolvedValue({ data: null, error: new Error("private database detail") })

    const response = await GET(request())
    const serialized = JSON.stringify(await response.json())

    expect(response.status).toBe(500)
    expect(serialized).toContain("Failed to preview workspace data")
    expect(serialized).not.toContain("private database detail")
  })
})
