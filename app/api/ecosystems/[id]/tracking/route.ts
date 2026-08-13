import { type NextRequest, NextResponse } from "next/server"
import { getProjectContributorTracking, upsertProjectContributorTracking } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import {
  normalizeOptionalIsoDate,
  normalizeOptionalNotes,
  normalizeProjectOutreachStatus,
  normalizeUuid,
  readJsonObject,
} from "@/lib/validation"

type RouteContext = {
  params: Promise<{ id: string }>
}

type ProjectTrackingDbIssue = {
  error: string
  code: string
  status: number
  allowFetchFallback?: boolean
}

function projectTrackingDbIssue(error: unknown): ProjectTrackingDbIssue | null {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : ""
  const message = error instanceof Error ? error.message : ""
  const detail = error && typeof error === "object" && "details" in error ? String(error.details) : ""
  const hint = error && typeof error === "object" && "hint" in error ? String(error.hint) : ""
  const searchable = `${code} ${message} ${detail} ${hint}`.toLowerCase()

  if (code === "42703") {
    return {
      error: "Project outreach tracking schema is out of date. Re-run db/migrations/017_project_contributor_tracking.sql in Supabase.",
      code: "project_tracking_schema_outdated",
      status: 503,
      allowFetchFallback: true,
    }
  }

  if (code === "42P10" || searchable.includes("unique") || searchable.includes("on conflict")) {
    return {
      error: "Project outreach tracking is missing its project/contributor unique constraint. Re-run db/migrations/017_project_contributor_tracking.sql in Supabase.",
      code: "project_tracking_unique_constraint_missing",
      status: 503,
    }
  }

  if (
    code === "42P01" ||
    (searchable.includes("project_contributor_tracking") && searchable.includes("does not exist")) ||
    searchable.includes("could not find the table")
  ) {
    return {
      error: "Project outreach tracking is not installed. Apply db/migrations/017_project_contributor_tracking.sql in Supabase, then redeploy or retry.",
      code: "project_tracking_migration_missing",
      status: 503,
      allowFetchFallback: true,
    }
  }

  return null
}

function projectTrackingDbError(error: unknown, action: "fetch" | "update") {
  const issue = projectTrackingDbIssue(error)
  if (issue) {
    return NextResponse.json(
      {
        error: issue.error,
        code: issue.code,
      },
      { status: issue.status }
    )
  }

  return NextResponse.json(
    {
      error:
        action === "fetch"
          ? "Project tracking could not load. Check server logs for Supabase error details."
          : "Failed to update project tracking",
      code: "project_tracking_request_failed",
    },
    { status: 500 }
  )
}

function projectTrackingFetchFallback(error: unknown) {
  const issue = projectTrackingDbIssue(error)
  if (!issue?.allowFetchFallback) return null

  return NextResponse.json({
    tracking: [],
    warning: issue.error,
    code: issue.code,
  })
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id } = await context.params
    const ecosystemId = normalizeUuid(id)
    if (!ecosystemId) return NextResponse.json({ error: "Invalid project id" }, { status: 400 })

    const tracking = await getProjectContributorTracking(ecosystemId, teamId)
    return NextResponse.json({ tracking })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("Project not found")) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    console.error("[ecosystems/[id]/tracking] GET error:", {
      error,
      message: error instanceof Error ? error.message : String(error),
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
      details: error && typeof error === "object" && "details" in error ? error.details : undefined,
      hint: error && typeof error === "object" && "hint" in error ? error.hint : undefined,
    })
    const fallback = projectTrackingFetchFallback(error)
    if (fallback) return fallback
    return projectTrackingDbError(error, "fetch")
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id } = await context.params
    const body = await readJsonObject(request)
    const ecosystemId = normalizeUuid(id)
    const contributorId = normalizeUuid(body?.contributorId)
    if (!body || !ecosystemId || !contributorId) {
      return NextResponse.json({ error: "Missing or invalid project or contributor id" }, { status: 400 })
    }

    const status = body.status === undefined ? undefined : normalizeProjectOutreachStatus(body.status)
    const notes = normalizeOptionalNotes(body.notes)
    const lastContactedAt = normalizeOptionalIsoDate(body.lastContactedAt)
    const nextFollowUpAt = normalizeOptionalIsoDate(body.nextFollowUpAt)

    if (body.status !== undefined && status === undefined) {
      return NextResponse.json({ error: "Invalid outreach status" }, { status: 400 })
    }
    if (body.notes !== undefined && notes === undefined) {
      return NextResponse.json({ error: "Invalid notes" }, { status: 400 })
    }
    if (body.lastContactedAt !== undefined && lastContactedAt === undefined) {
      return NextResponse.json({ error: "Invalid lastContactedAt" }, { status: 400 })
    }
    if (body.nextFollowUpAt !== undefined && nextFollowUpAt === undefined) {
      return NextResponse.json({ error: "Invalid nextFollowUpAt" }, { status: 400 })
    }

    const tracking = await upsertProjectContributorTracking(
      ecosystemId,
      contributorId,
      {
        status,
        notes: body.notes !== undefined ? notes ?? null : undefined,
        lastContactedAt: body.lastContactedAt !== undefined ? lastContactedAt ?? null : undefined,
        nextFollowUpAt: body.nextFollowUpAt !== undefined ? nextFollowUpAt ?? null : undefined,
      },
      teamId
    )
    return NextResponse.json({ tracking })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("Project not found")) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 })
    }
    if (error instanceof Error && error.message.includes("Contributor not found")) {
      return NextResponse.json({ error: "Contributor not found" }, { status: 404 })
    }
    console.error("[ecosystems/[id]/tracking] PATCH error:", {
      error,
      message: error instanceof Error ? error.message : String(error),
      code: error && typeof error === "object" && "code" in error ? error.code : undefined,
      details: error && typeof error === "object" && "details" in error ? error.details : undefined,
      hint: error && typeof error === "object" && "hint" in error ? error.hint : undefined,
    })
    return projectTrackingDbError(error, "update")
  }
}
