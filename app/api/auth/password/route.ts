import { type NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/permissions"
import { clearAuthCookie, getAuthSession } from "@/lib/auth"
import { revokeAllAuthSessions } from "@/lib/auth-sessions"
import { hashAuditValue, recordAuditEvent } from "@/lib/audit"
import { supabaseAdmin, supabaseAuth } from "@/lib/supabase"
import { readJsonObject } from "@/lib/validation"

const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") return null
  const password = value.trim()
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH ? password : null
}

export async function POST(request: NextRequest) {
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  const session = getAuthSession(request)
  if (!session || session.actor !== "user") {
    return NextResponse.json({ error: "Password changes are only available for team user accounts." }, { status: 403 })
  }

  const body = await readJsonObject(request)
  const currentPassword = normalizePassword(body?.currentPassword)
  const newPassword = normalizePassword(body?.newPassword)

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Current and new passwords must be 8 to 128 characters." }, { status: 400 })
  }

  if (currentPassword === newPassword) {
    return NextResponse.json({ error: "New password must be different from the current password." }, { status: 400 })
  }

  const { data, error } = await supabaseAuth.auth.signInWithPassword({
    email: session.email,
    password: currentPassword,
  })

  if (error || !data.user?.id) {
    await recordAuditEvent({
      request,
      action: "auth.password_change",
      outcome: "failure",
      actor: "user",
      teamId: session.teamId,
      metadata: { reason: "invalid_current_password", emailHash: hashAuditValue(session.email) },
    })
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 })
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
    password: newPassword,
  })

  if (updateError) {
    console.error("[auth/password] update error:", updateError)
    await recordAuditEvent({
      request,
      action: "auth.password_change",
      outcome: "failure",
      actor: "user",
      teamId: session.teamId,
      metadata: { reason: "update_failed", emailHash: hashAuditValue(session.email) },
    })
    return NextResponse.json({ error: "Failed to update password." }, { status: 500 })
  }

  try {
    await revokeAllAuthSessions(session, "password_change")
  } catch {
    await recordAuditEvent({
      request,
      action: "auth.password_change",
      outcome: "failure",
      actor: "user",
      teamId: session.teamId,
      metadata: { reason: "session_revocation_failed", emailHash: hashAuditValue(session.email) },
    })
    const response = NextResponse.json(
      { error: "Password changed, but existing sessions could not be revoked. Contact an administrator." },
      { status: 503 }
    )
    clearAuthCookie(response)
    return response
  }

  await recordAuditEvent({
    request,
    action: "auth.password_change",
    outcome: "success",
    actor: "user",
    teamId: session.teamId,
    metadata: { emailHash: hashAuditValue(session.email), teamSlug: session.teamSlug, role: session.role },
  })

  const response = NextResponse.json({ success: true, requiresLogin: true })
  clearAuthCookie(response)
  return response
}
