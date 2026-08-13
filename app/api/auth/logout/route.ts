import { type NextRequest, NextResponse } from "next/server"
import { clearAuthCookie } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { requireSameOrigin } from "@/lib/request-origin"

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request)
  if (originError) return originError

  await recordAuditEvent({ request, action: "auth.logout", outcome: "success" })
  const response = NextResponse.json({ success: true })
  clearAuthCookie(response)
  return response
}
