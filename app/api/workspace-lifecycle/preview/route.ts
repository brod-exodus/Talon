import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { logError } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

const COUNT_KEYS = [
  "members", "authSessions", "contributors", "scrapes", "scrapeContributors",
  "sharedScrapes", "projects", "projectScrapes", "projectCaches", "projectLists",
  "projectListContributors", "projectTracking", "watchedRepositories", "watchedContributors",
  "scrapeJobs", "scrapeJobContributions", "scrapeJobRepositoryContributions", "scrapeJobEvents",
  "scrapeEnqueueRequests", "notificationDeliveries", "activityEvents", "auditEvents",
] as const

const BLOCKER_KEYS = [
  "activeScrapes", "activeScrapeJobs", "activeNotificationDeliveries",
  "activeSharedLinks", "activeAuthSessions",
] as const

function nonNegativeInteger(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid lifecycle count")
  return parsed
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid lifecycle preview")
  return value as Record<string, unknown>
}

function normalizePreview(value: unknown) {
  const preview = readRecord(value)
  const counts = readRecord(preview.counts)
  const blockers = readRecord(preview.blockers)
  if (preview.version !== 1) throw new Error("Unsupported lifecycle preview version")
  const generatedAt = typeof preview.generatedAt === "string" ? preview.generatedAt : ""
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) throw new Error("Invalid lifecycle timestamp")

  const normalizedBlockers = Object.fromEntries(
    BLOCKER_KEYS.map((key) => [key, nonNegativeInteger(blockers[key])])
  ) as Record<(typeof BLOCKER_KEYS)[number], number>

  return {
    version: 1,
    generatedAt,
    counts: Object.fromEntries(COUNT_KEYS.map((key) => [key, nonNegativeInteger(counts[key])])),
    blockers: normalizedBlockers,
    hasActiveWork: normalizedBlockers.activeScrapes > 0
      || normalizedBlockers.activeScrapeJobs > 0
      || normalizedBlockers.activeNotificationDeliveries > 0,
    externalData: {
      supabaseAuth: "not_counted",
      profilePhotoStorage: "not_counted",
      encryptedBackups: "not_counted",
      downloadedExports: "outside_talon_control",
    },
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "manage_members")
  if (authError) return authError

  let teamId: string
  try {
    teamId = (await resolveTeamContext(request)).teamId
  } catch (error) {
    return teamContextError(error, requestId)
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("preview_workspace_lifecycle", { p_team_id: teamId })
    if (error) throw error
    return NextResponse.json(
      { preview: normalizePreview(data) },
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    logError("workspace.lifecycle_preview_failed", error, { requestId })
    return internalErrorResponse("workspace_lifecycle_preview_failed", requestId)
  }
}
