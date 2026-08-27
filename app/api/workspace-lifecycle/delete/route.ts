import { type NextRequest, NextResponse } from "next/server"
import { clearAuthCookie, getAuthSession } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { internalErrorResponse, serviceErrorResponse } from "@/lib/api-error-response"
import { logError } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { runStorageCleanupTask } from "@/lib/storage-cleanup-worker"

type DatabaseReceipt = { version: 1; receiptId: string; deletedAt: string; hasStorageCleanup: boolean }

function validReceipt(value: unknown): value is DatabaseReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const receipt = value as Record<string, unknown>
  return receipt.version === 1
    && typeof receipt.receiptId === "string"
    && /^[0-9a-f-]{36}$/i.test(receipt.receiptId)
    && typeof receipt.deletedAt === "string"
    && !Number.isNaN(Date.parse(receipt.deletedAt))
    && typeof receipt.hasStorageCleanup === "boolean"
}

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "manage_members")
  if (authError) return authError

  const session = getAuthSession(request)
  if (session?.actor !== "user") {
    return NextResponse.json(
      { error: "Workspace deletion requires a signed-in workspace owner." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    )
  }

  let team: Awaited<ReturnType<typeof resolveTeamContext>>
  try {
    team = await resolveTeamContext(request)
  } catch (error) {
    return teamContextError(error, requestId)
  }

  let confirmation = ""
  try {
    const body = await request.json()
    confirmation = typeof body?.confirmation === "string" ? body.confirmation : ""
  } catch {
    return NextResponse.json({ error: "Enter the workspace name to confirm deletion." }, { status: 400 })
  }

  if (confirmation !== team.teamSlug) {
    await recordAuditEvent({
      request, action: "workspace.delete", outcome: "blocked", teamId: team.teamId,
      metadata: { reason: "confirmation_mismatch" },
    })
    return NextResponse.json(
      { error: `Type ${team.teamSlug} exactly to confirm deletion.` },
      { status: 400, headers: { "Cache-Control": "private, no-store" } }
    )
  }

  try {
    const { data, error } = await supabaseAdmin.rpc("delete_workspace_data", {
      p_team_id: team.teamId,
      p_confirmation: confirmation,
    })
    if (error) {
      if (error.code === "55006") return serviceErrorResponse("workspace_delete_active_work", requestId)
      throw error
    }
    if (!validReceipt(data)) throw new Error("Invalid workspace deletion receipt")

    let profilePhotoCleanup: "complete" | "queued" = "complete"
    if (data.hasStorageCleanup) {
      try {
        const cleanup = await runStorageCleanupTask(data.receiptId)
        profilePhotoCleanup = cleanup.status === "succeeded" ? "complete" : "queued"
      } catch (cleanupError) {
        profilePhotoCleanup = "queued"
        logError("workspace.storage_cleanup_dispatch_failed", cleanupError, { requestId })
      }
    }

    const response = NextResponse.json(
      {
        success: true,
        receipt: { version: data.version, receiptId: data.receiptId, deletedAt: data.deletedAt },
        profilePhotoCleanup,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    )
    clearAuthCookie(response)
    return response
  } catch (error) {
    await recordAuditEvent({ request, action: "workspace.delete", outcome: "failure", teamId: team.teamId })
    logError("workspace.delete_failed", error, { requestId })
    return internalErrorResponse("workspace_delete_failed", requestId)
  }
}
