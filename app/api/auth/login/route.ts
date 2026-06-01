import { type NextRequest, NextResponse } from "next/server"
import { createSessionToken, setAuthCookie, validateAdminPassword } from "@/lib/auth"
import { hashAuditValue, recordAuditEvent } from "@/lib/audit"
import { checkLoginRateLimit, recordLoginFailure, resetLoginRateLimit } from "@/lib/login-rate-limit"
import { supabaseAuth } from "@/lib/supabase"
import { ensurePrivateWorkspaceForUser, getPrimaryTeamMembershipForEmail } from "@/lib/team-membership"
import { readJsonObject } from "@/lib/validation"
import { type AuthRole } from "@/lib/auth-token"

function normalizeLoginEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

function displayNameFromUser(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }): string | null {
  const metadata = user.user_metadata ?? {}
  const value = metadata.display_name ?? metadata.full_name ?? metadata.name
  return typeof value === "string" && value.trim() ? value.trim() : user.email?.split("@")[0] ?? null
}

function appRoleFromUser(user: { user_metadata?: Record<string, unknown> | null }): AuthRole | null {
  const role = user.user_metadata?.app_role
  return role === "owner" || role === "admin" || role === "recruiter" || role === "viewer" ? role : null
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
      const reason = error?.message?.toLowerCase().includes("email not confirmed")
        ? "email_not_confirmed"
        : "invalid_user_credentials"
      await recordAuditEvent({
        request,
        action: "auth.login",
        outcome: "failure",
        actor: "user",
        metadata: { reason, emailHash: hashAuditValue(email) },
      })
      return NextResponse.json({
        error: reason === "email_not_confirmed"
          ? "This account is not confirmed yet. Ask an admin to open Settings > Team Access and save the teammate with a temporary password."
          : "Invalid email or password",
      }, { status: 401 })
    }

    await ensurePrivateWorkspaceForUser(data.user.email, displayNameFromUser(data.user), appRoleFromUser(data.user))
    const membership = await getPrimaryTeamMembershipForEmail(data.user.email)
    if (!membership) {
      throw new Error("Private workspace was provisioned, but no team membership could be resolved.")
    }

    await resetLoginRateLimit(request)
    await recordAuditEvent({
      request,
      action: "auth.login",
      outcome: "success",
      actor: "user",
      teamId: membership.teamId,
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
