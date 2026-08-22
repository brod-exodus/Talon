import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { requirePermission } from "@/lib/permissions"
import { getRecentAuditEvents } from "@/lib/audit"
import { logError } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

function csvCell(value: unknown): string {
  const str = value == null ? "" : String(value)
  return `"${str.replace(/"/g, "\"\"")}"`
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "admin")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const limitParam = request.nextUrl.searchParams.get("limit")
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 25
    const events = await getRecentAuditEvents(Number.isFinite(limit) ? limit : 25, teamId)
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
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error, requestId)
    logError("audit.list_failed", error, { requestId })
    return internalErrorResponse("audit_list_failed", requestId)
  }
}
