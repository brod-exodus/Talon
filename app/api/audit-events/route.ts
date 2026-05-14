import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getRecentAuditEvents } from "@/lib/audit"

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const limitParam = request.nextUrl.searchParams.get("limit")
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 25
    const events = await getRecentAuditEvents(Number.isFinite(limit) ? limit : 25)
    return NextResponse.json({ events })
  } catch (error) {
    console.error("[audit-events] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch audit events" }, { status: 500 })
  }
}
