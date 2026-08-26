import { type NextRequest, NextResponse } from "next/server"
import { recordAuditEvent } from "@/lib/audit"
import { internalErrorResponse, serviceErrorResponse } from "@/lib/api-error-response"
import { logError } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import {
  MAX_IMMEDIATE_WORKSPACE_EXPORT_BYTES,
  serializeWorkspaceExport,
} from "@/lib/workspace-export"

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "manage_members")
  if (authError) return authError

  let teamId: string
  try {
    teamId = (await resolveTeamContext(request)).teamId
  } catch (error) {
    return teamContextError(error, requestId)
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("export_workspace_data", { p_team_id: teamId })
    if (error) throw error

    const exported = serializeWorkspaceExport(data)
    if (exported.bytes > MAX_IMMEDIATE_WORKSPACE_EXPORT_BYTES) {
      await recordAuditEvent({
        request,
        action: "workspace.export",
        outcome: "blocked",
        teamId,
        metadata: { reason: "immediate_export_size_limit", bytes: exported.bytes },
      })
      return serviceErrorResponse("workspace_export_too_large", requestId)
    }

    await recordAuditEvent({
      request,
      action: "workspace.export",
      outcome: "success",
      teamId,
      metadata: { formatVersion: 1, bytes: exported.bytes },
    })

    const date = new Date().toISOString().slice(0, 10)
    return new NextResponse(exported.body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="talon-workspace-export-${date}.json"`,
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    })
  } catch (error) {
    await recordAuditEvent({
      request,
      action: "workspace.export",
      outcome: "failure",
      teamId,
    })
    logError("workspace.export_failed", error, { requestId })
    return internalErrorResponse("workspace_export_failed", requestId)
  }
}
