import { type NextRequest, NextResponse } from "next/server"
import { createSessionToken, setAuthCookie, validateAdminPassword } from "@/lib/auth"
import { hashAuditValue, recordAuditEvent } from "@/lib/audit"
import { checkLoginRateLimit, recordLoginFailure, resetLoginRateLimit } from "@/lib/login-rate-limit"
import { supabaseAuth } from "@/lib/supabase"
import { getPrimaryTeamMembershipForEmail } from "@/lib/team-membership"
import { readJsonObject } from "@/lib/validation"

function normalizeLoginEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

export async function POST(request: NextRequest) {
  const rateLimit = await checkLoginRateLimit(request)
  if (!rateLimit.allowed) {
    await recordAuditEvent({
      request,
      action: "auth.login",
      outcome: "blocked",
      metadata: { reason: "rate_limited" },
    })
    return NextResponse.json(
      { error: "Too many failed login attempts. Please try again later." },
      {
        status: 429,
        headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined,
      }
    )
  }

  const body = await readJsonObject(request)
  const email = normalizeLoginEmail(body?.email)
  const password = body?.password

  if (email) {
    if (typeof password !== "string" || !password) {
      await recordLoginFailure(request)
      await recordAuditEvent({
        request,
        action: "auth.login",
        outcome: "failure",
        actor: "user",
        metadata: { reason: "missing_password", emailHash: hashAuditValue(email) },
      })
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password })
    if (error || !data.user?.email) {
      await recordLoginFailure(request)
      await recordAuditEvent({
        request,
        action: "auth.login",
        outcome: "failure",
        actor: "user",
        metadata: { reason: "invalid_user_credentials", emailHash: hashAuditValue(email) },
      })
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 })
    }

    const membership = await getPrimaryTeamMembershipForEmail(data.user.email)
    if (!membership) {
      await recordLoginFailure(request)
      await recordAuditEvent({
        request,
        action: "auth.login",
        outcome: "failure",
        actor: "user",
        metadata: { reason: "missing_team_membership", emailHash: hashAuditValue(email) },
      })
      return NextResponse.json({ error: "No Talon team membership is configured for this user" }, { status: 403 })
    }

    await resetLoginRateLimit(request)
    await recordAuditEvent({
      request,
      action: "auth.login",
      outcome: "success",
      actor: "user",
      metadata: { teamSlug: membership.teamSlug, role: membership.role, emailHash: hashAuditValue(membership.email) },
    })

    const response = NextResponse.json({
      success: true,
      actor: "user",
      teamSlug: membership.teamSlug,
      role: membership.role,
    })
    setAuthCookie(response, createSessionToken({ actor: "user", ...membership }))
    return response
  }

  if (!validateAdminPassword(password)) {
    await recordLoginFailure(request)
    await recordAuditEvent({
      request,
      action: "auth.login",
      outcome: "failure",
      metadata: { reason: "invalid_password" },
    })
    return NextResponse.json({ error: "Invalid password" }, { status: 401 })
  }

  await resetLoginRateLimit(request)
  await recordAuditEvent({ request, action: "auth.login", outcome: "success", actor: "admin" })

  const response = NextResponse.json({ success: true, actor: "admin" })
  setAuthCookie(response, createSessionToken())
  return response
}
