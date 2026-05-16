import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { updateContributorOutreach } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import {
  normalizeGithubUsername,
  normalizeOptionalIsoDate,
  normalizeOptionalNotes,
  normalizeOptionalStatus,
  readJsonObject,
} from "@/lib/validation"

export async function PATCH(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
    const body = await readJsonObject(request)
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const username = normalizeGithubUsername(body.username)
    if (!username) {
      return NextResponse.json({ error: "Missing or invalid username" }, { status: 400 })
    }

    const updates: {
      contacted?: boolean
      contacted_date?: string | null
      outreach_notes?: string | null
      status?: string | null
    } = {}
    if (typeof body.contacted === "boolean") updates.contacted = body.contacted
    const contactedDate = normalizeOptionalIsoDate(body.contactedDate)
    if (body.contactedDate !== undefined && contactedDate === undefined) {
      return NextResponse.json({ error: "Invalid contactedDate" }, { status: 400 })
    }
    if (body.contactedDate !== undefined) updates.contacted_date = contactedDate ?? null
    const notes = normalizeOptionalNotes(body.notes)
    const status = normalizeOptionalStatus(body.status)
    if (body.notes !== undefined && notes === undefined) {
      return NextResponse.json({ error: "Invalid notes" }, { status: 400 })
    }
    if (body.status !== undefined && status === undefined) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    if (body.notes !== undefined) updates.outreach_notes = notes ?? null
    if (body.status !== undefined) updates.status = status ?? null

    await updateContributorOutreach(username, updates, teamId)
    await recordAuditEvent({
      request,
      action: "outreach.update",
      outcome: "success",
      metadata: {
        username,
        teamSlug,
        fields: Object.keys(updates),
      },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[v0] Update contributor outreach error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update contributor" },
      { status: 500 }
    )
  }
}
