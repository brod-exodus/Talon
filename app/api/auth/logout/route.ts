import { type NextRequest, NextResponse } from "next/server"
import { serviceErrorResponse } from "@/lib/api-error-response"
import { clearAuthCookie, getAuthSession } from "@/lib/auth"
import { revokeAuthSession } from "@/lib/auth-sessions"
import { recordAuditEvent } from "@/lib/audit"
import { logError } from "@/lib/logger"
import { requireSameOrigin } from "@/lib/request-origin"
import { getRequestId } from "@/lib/request-id"

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
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
  } catch (error) {
    logError("auth.logout_revoke_failed", error, { requestId })
    await recordAuditEvent({
      request,
      action: "auth.logout",
      outcome: "failure",
      metadata: { reason: "session_revocation_failed" },
    })
    const errorResponse = serviceErrorResponse("auth_logout_revoke_unavailable", requestId)
    clearAuthCookie(errorResponse)
    return errorResponse
  }
}
