import { type NextRequest, NextResponse } from "next/server"
import { getAuthSession, requireAuth } from "@/lib/auth"
import { hashAuditValue, recordAuditEvent } from "@/lib/audit"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { readJsonObject } from "@/lib/validation"

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const displayName = value.trim().replace(/\s+/g, " ")
  return displayName.length >= 1 && displayName.length <= 120 ? displayName : null
}

function profileMigrationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42703"
  )
}

function profileStorageNotReady() {
  return NextResponse.json(
    { error: "Profile storage is not ready. Apply db/migrations/012_team_profile_photos.sql." },
    { status: 500 }
  )
}

export async function PATCH(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  const session = getAuthSession(request)
  if (session?.actor !== "user") {
    return NextResponse.json({ error: "Profiles are available for team user accounts." }, { status: 403 })
  }

  try {
    const body = await readJsonObject(request)
    const displayName = normalizeDisplayName(body?.displayName)
    if (!displayName) return NextResponse.json({ error: "Display name is required." }, { status: 400 })

    const team = await resolveTeamContext(request)
    const { error } = await supabaseAdmin
      .from("team_memberships")
      .update({
        display_name: displayName,
        profile_updated_at: new Date().toISOString(),
      })
      .eq("team_id", team.teamId)
      .eq("email", session.email)
    if (error) {
      if (profileMigrationError(error)) return profileStorageNotReady()
      throw error
    }

    await recordAuditEvent({
      request,
      action: "profile.update",
      outcome: "success",
      actor: "user",
      metadata: { teamSlug: team.teamSlug, emailHash: hashAuditValue(session.email) },
    })

    return NextResponse.json({ displayName })
  } catch (error) {
    console.error("[profile] PATCH error:", error)
    if (error instanceof Error && (error.message.includes("Default team is missing") || error.message.includes("not a member"))) {
      return teamContextError(error)
    }
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 })
  }
}
