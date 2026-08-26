import { type NextRequest, NextResponse } from "next/server"
import { hashAuditValue, recordAuditEvent } from "@/lib/audit"
import { serviceErrorResponse } from "@/lib/api-error-response"
import { revokeAllAuthSessionsForIdentity } from "@/lib/auth-sessions"
import { logError } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"
import { requireSameOrigin } from "@/lib/request-origin"
import { createSupabaseAuthClient, supabaseAdmin } from "@/lib/supabase"
import { getPrimaryTeamMembershipForEmail } from "@/lib/team-membership"
import { readJsonObject } from "@/lib/validation"

const INVALID_LINK_MESSAGE = "This password reset link is invalid or has expired. Request a new link and try again."
const PASSWORD_MIN_LENGTH = 8
const PASSWORD_MAX_LENGTH = 128

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") return null
  const password = value.trim()
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH ? password : null
}

function normalizeTokenHash(value: unknown): string | null {
  if (typeof value !== "string") return null
  const token = value.trim()
  return token.length >= 32 && token.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(token) ? token : null
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request)
  if (originError) return originError

  const requestId = getRequestId(request)
  const body = await readJsonObject(request)
  const tokenHash = normalizeTokenHash(body?.tokenHash)
  const password = normalizePassword(body?.password)
  if (!tokenHash || !password) {
    return NextResponse.json({ error: tokenHash ? "Password must be 8 to 128 characters." : INVALID_LINK_MESSAGE }, { status: 400 })
  }

  const auth = createSupabaseAuthClient()
  const { data, error } = await auth.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
  const email = data.user?.email?.trim().toLowerCase() ?? null
  if (error || !data.user?.id || !email) {
    return NextResponse.json({ error: INVALID_LINK_MESSAGE }, { status: 400 })
  }

  let membership
  try {
    membership = await getPrimaryTeamMembershipForEmail(email)
  } catch (membershipError) {
    logError("auth.password_reset_membership_failed", membershipError, { requestId })
    return serviceErrorResponse("auth_password_reset_unavailable", requestId)
  }
  if (!membership) {
    await recordAuditEvent({
      request,
      action: "auth.password_reset",
      outcome: "failure",
      actor: "user",
      metadata: { reason: "membership_missing", emailHash: hashAuditValue(email) },
    })
    return NextResponse.json({ error: INVALID_LINK_MESSAGE }, { status: 400 })
  }

  try {
    await revokeAllAuthSessionsForIdentity(membership, "password_change")
  } catch (sessionError) {
    logError("auth.password_reset_session_revoke_failed", sessionError, { requestId, teamId: membership.teamId })
    await recordAuditEvent({
      request,
      action: "auth.password_reset",
      outcome: "failure",
      actor: "user",
      teamId: membership.teamId,
      metadata: { reason: "session_revocation_failed", emailHash: hashAuditValue(email) },
    })
    return serviceErrorResponse("auth_password_reset_session_revoke_unavailable", requestId)
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, { password })
  if (updateError) {
    logError("auth.password_reset_update_failed", updateError, { requestId, teamId: membership.teamId })
    await recordAuditEvent({
      request,
      action: "auth.password_reset",
      outcome: "failure",
      actor: "user",
      teamId: membership.teamId,
      metadata: { reason: "update_failed", emailHash: hashAuditValue(email) },
    })
    return NextResponse.json({ error: "Password could not be updated. Request a new link and try again." }, { status: 400 })
  }

  await recordAuditEvent({
    request,
    action: "auth.password_reset",
    outcome: "success",
    actor: "user",
    teamId: membership.teamId,
    metadata: { emailHash: hashAuditValue(email), teamSlug: membership.teamSlug, role: membership.role },
  })
  return NextResponse.json({ success: true, requiresLogin: true })
}
