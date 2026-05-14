import { type NextRequest, NextResponse } from "next/server"
import { clearAuthCookie } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"

export async function POST(request: NextRequest) {
  await recordAuditEvent({ request, action: "auth.logout", outcome: "success" })
  const response = NextResponse.json({ success: true })
  clearAuthCookie(response)
  return response
}
