import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse, serviceErrorResponse } from "@/lib/api-error-response"
import { requirePermission } from "@/lib/permissions"
import { getAuthSession } from "@/lib/auth"
import { hashAuditValue, recordAuditEvent } from "@/lib/audit"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { readJsonObject } from "@/lib/validation"
import { logError, logWarnError } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"

type AuthUserSummary = {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown> | null
}

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

function profileStorageNotReady(requestId: string) {
  return serviceErrorResponse("profile_storage_not_ready", requestId)
}

async function findAuthUserByEmail(email: string): Promise<AuthUserSummary | null> {
  let page = 1
  while (page <= 10) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const user = (data.users ?? []).find((item) => item.email?.toLowerCase() === email.toLowerCase())
    if (user) return user as AuthUserSummary
    if ((data.users ?? []).length < 1000) return null
    page += 1
  }
  return null
}

export async function PATCH(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
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
      if (profileMigrationError(error)) return profileStorageNotReady(requestId)
      throw error
    }

    try {
      const authUser = await findAuthUserByEmail(session.email)
      if (authUser?.id) {
        const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
          user_metadata: {
            ...(authUser.user_metadata ?? {}),
            display_name: displayName,
          },
        })
        if (metadataError) throw metadataError
      }
    } catch (metadataError) {
      logWarnError("profile.auth_metadata_sync_failed", metadataError, {
        requestId,
        teamId: team.teamId,
      })
    }

    await recordAuditEvent({
      request,
      action: "profile.update",
      outcome: "success",
      actor: "user",
      teamId: team.teamId,
      metadata: { teamSlug: team.teamSlug, emailHash: hashAuditValue(session.email) },
    })

    return NextResponse.json({ displayName })
  } catch (error) {
    if (error instanceof Error && (error.message.includes("Default team is missing") || error.message.includes("not a member"))) {
      return teamContextError(error, requestId)
    }
    logError("profile.update_failed", error, { requestId })
    return internalErrorResponse("profile_update_failed", requestId)
  }
}
