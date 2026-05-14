import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getRecentAuditEvents } from "@/lib/audit"

function csvCell(value: unknown): string {
  const str = value == null ? "" : String(value)
  return `"${str.replace(/"/g, "\"\"")}"`
}

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const limitParam = request.nextUrl.searchParams.get("limit")
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 25
    const events = await getRecentAuditEvents(Number.isFinite(limit) ? limit : 25)
    if (request.nextUrl.searchParams.get("format") === "csv") {
      const rows = [
        ["created_at", "action", "outcome", "actor", "ip_hash", "user_agent", "metadata_json"].join(","),
        ...events.map((event) =>
          [
            csvCell(event.createdAt),
            csvCell(event.action),
            csvCell(event.outcome),
            csvCell(event.actor),
            csvCell(event.ipHash),
            csvCell(event.userAgent),
            csvCell(JSON.stringify(event.metadata ?? {})),
          ].join(",")
        ),
      ]
      const body = rows.join("\n")
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=\"talon-audit-events-${new Date().toISOString().slice(0, 10)}.csv\"`,
          "Cache-Control": "no-store",
        },
      })
    }
    return NextResponse.json({ events })
  } catch (error) {
    console.error("[audit-events] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch audit events" }, { status: 500 })
  }
}
