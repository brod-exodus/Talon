import { type NextRequest, NextResponse } from "next/server"
import { clearAuthCookie, getAuthSession } from "@/lib/auth"
import { revokeAuthSession } from "@/lib/auth-sessions"
import { recordAuditEvent } from "@/lib/audit"
import { requireSameOrigin } from "@/lib/request-origin"

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request)
  if (originError) return originError

  const response = NextResponse.json({ success: true })
  clearAuthCookie(response)
  const session = getAuthSession(request)
  if (!session) return response

  try {
    await revokeAuthSession(session, "logout")
    await recordAuditEvent({ request, action: "auth.logout", outcome: "success" })
    return response
  } catch {
    await recordAuditEvent({
      request,
      action: "auth.logout",
      outcome: "failure",
      metadata: { reason: "session_revocation_failed" },
    })
    const errorResponse = NextResponse.json(
      { error: "Signed out locally, but the server session could not be revoked." },
      { status: 503 }
    )
    clearAuthCookie(errorResponse)
    return errorResponse
  }
}
