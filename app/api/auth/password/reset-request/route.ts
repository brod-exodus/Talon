import { type NextRequest, NextResponse } from "next/server"
import { hashAuditValue, recordAuditEvent } from "@/lib/audit"
import { checkPasswordResetRateLimit, recordPasswordResetRequest } from "@/lib/login-rate-limit"
import { logError } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"
import { requireSameOrigin } from "@/lib/request-origin"
import { createSupabaseAuthClient } from "@/lib/supabase"
import { readJsonObject } from "@/lib/validation"

const GENERIC_MESSAGE = "If that email belongs to a Talon account, a password reset link is on its way."

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request)
  if (originError) return originError

  const rateLimit = await checkPasswordResetRateLimit(request)
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many password reset requests. Please try again later." },
      { status: 429, headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined }
    )
  }

  const body = await readJsonObject(request)
  const email = normalizeEmail(body?.email)
  await recordPasswordResetRequest(request)

  if (!email) {
    return NextResponse.json({ message: GENERIC_MESSAGE })
  }

  const requestId = getRequestId(request)
  const redirectTo = new URL("/reset-password", request.nextUrl.origin).toString()
  const { error } = await createSupabaseAuthClient().auth.resetPasswordForEmail(email, { redirectTo })

  if (error) {
    logError("auth.password_reset_request_failed", error, { requestId })
    await recordAuditEvent({
      request,
      action: "auth.password_reset_request",
      outcome: "failure",
      actor: "anonymous",
      metadata: { emailHash: hashAuditValue(email) },
    })
  } else {
    await recordAuditEvent({
      request,
      action: "auth.password_reset_request",
      outcome: "success",
      actor: "anonymous",
      metadata: { emailHash: hashAuditValue(email) },
    })
  }

  return NextResponse.json({ message: GENERIC_MESSAGE })
}
