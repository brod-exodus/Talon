import { type NextRequest, NextResponse } from "next/server"
import { setAuthCookie } from "@/lib/auth"
import { issueSessionToken } from "@/lib/auth-sessions"
import { hashAuditValue, recordAuditEvent } from "@/lib/audit"
import { checkLoginRateLimit, recordLoginFailure, resetLoginRateLimit } from "@/lib/login-rate-limit"
import { supabaseAdmin } from "@/lib/supabase"
import { ensurePrivateWorkspaceForUser } from "@/lib/team-membership"
import { readJsonObject } from "@/lib/validation"
import { requireSameOrigin } from "@/lib/request-origin"
import { isSelfServiceSignupEnabled } from "@/lib/registration-policy"

const PASSWORD_MIN_LENGTH = 8

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") return null
  const password = value.trim()
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= 128 ? password : null
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const displayName = value.trim().replace(/\s+/g, " ")
  return displayName.length >= 1 && displayName.length <= 120 ? displayName : null
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request)
  if (originError) return originError

  if (!isSelfServiceSignupEnabled()) {
    return NextResponse.json(
      { error: "Self-service registration is disabled. Ask a Talon administrator to create your account." },
      { status: 403 }
    )
  }

  const rateLimit = await checkLoginRateLimit(request)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      {
        status: 429,
        headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined,
      }
    )
  }

  try {
    const body = await readJsonObject(request)
    const email = normalizeEmail(body?.email)
    const password = normalizePassword(body?.password)
    const displayName = normalizeDisplayName(body?.displayName)

    if (!email) return NextResponse.json({ error: "Invalid email" }, { status: 400 })
    if (!displayName) return NextResponse.json({ error: "Display name is required" }, { status: 400 })
    if (!password) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 })

    const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, app_role: "owner" },
    })

    if (createError) {
      await recordLoginFailure(request)
      const alreadyExists =
        createError.message.toLowerCase().includes("already") ||
        createError.message.toLowerCase().includes("registered")
      await recordAuditEvent({
        request,
        action: "auth.signup",
        outcome: "failure",
        actor: "user",
        metadata: { reason: alreadyExists ? "account_exists" : "create_failed", emailHash: hashAuditValue(email) },
      })
      return NextResponse.json(
        { error: alreadyExists ? "An account already exists for this email." : "Could not create account." },
        { status: alreadyExists ? 409 : 500 }
      )
    }

    const membership = await ensurePrivateWorkspaceForUser(createdUser.user.email ?? email, displayName, "owner")

    const token = await issueSessionToken({ actor: "user", ...membership })
    await resetLoginRateLimit(request)
    await recordAuditEvent({
      request,
      action: "auth.signup",
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
    setAuthCookie(response, token)
    return response
  } catch (error) {
    console.error("[auth/signup] POST error:", error)
    return NextResponse.json({ error: "Could not create account." }, { status: 500 })
  }
}
