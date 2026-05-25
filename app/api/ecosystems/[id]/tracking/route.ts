import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
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

export async function GET(request: NextRequest, context: RouteContext) {
  const authError = requireAuth(request)
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
    console.error("[ecosystems/[id]/tracking] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch project tracking" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const authError = requirePermission(request, "write")
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
    console.error("[ecosystems/[id]/tracking] PATCH error:", error)
    return NextResponse.json({ error: "Failed to update project tracking" }, { status: 500 })
  }
}
