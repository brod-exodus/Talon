import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { recordAuditEvent } from "@/lib/audit"
import { requirePermission } from "@/lib/permissions"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid } from "@/lib/validation"
import { logError } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
    const { id } = await params
    const watchedRepoId = normalizeUuid(id)
    if (!watchedRepoId) {
      return NextResponse.json({ error: "Invalid watched repo id" }, { status: 400 })
    }

    // Remove linked contributor tracking rows first
    await supabaseAdmin
      .from("watched_repo_contributors")
      .delete()
      .eq("team_id", teamId)
      .eq("watched_repo_id", watchedRepoId)

    const { error } = await supabaseAdmin.from("watched_repos").delete().eq("id", watchedRepoId).eq("team_id", teamId)
    if (error) throw error

    await recordAuditEvent({
      request,
      action: "watched_repo.delete",
      outcome: "success",
      teamId,
      metadata: { watchedRepoId, teamSlug },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    logError("watched_repos.delete_failed", error, { requestId })
    return internalErrorResponse("watched_repo_delete_failed", requestId)
  }
}
