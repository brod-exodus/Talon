import { type NextRequest, NextResponse } from "next/server"
import { createSessionToken, setAuthCookie, validateAdminPassword } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { checkLoginRateLimit, recordLoginFailure, resetLoginRateLimit } from "@/lib/login-rate-limit"
import { readJsonObject } from "@/lib/validation"

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
  const password = body?.password

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
  await recordAuditEvent({ request, action: "auth.login", outcome: "success" })

  const response = NextResponse.json({ success: true })
  setAuthCookie(response, createSessionToken())
  return response
}
