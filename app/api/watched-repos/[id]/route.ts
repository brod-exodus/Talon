import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { supabase } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid } from "@/lib/validation"

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
    const { id } = await params
    const watchedRepoId = normalizeUuid(id)
    if (!watchedRepoId) {
      return NextResponse.json({ error: "Invalid watched repo id" }, { status: 400 })
    }

    // Remove linked contributor tracking rows first
    await supabase
      .from("watched_repo_contributors")
      .delete()
      .eq("team_id", teamId)
      .eq("watched_repo_id", watchedRepoId)

    const { error } = await supabase.from("watched_repos").delete().eq("id", watchedRepoId).eq("team_id", teamId)
    if (error) throw error

    await recordAuditEvent({
      request,
      action: "watched_repo.delete",
      outcome: "success",
      metadata: { watchedRepoId, teamSlug },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[watched-repos] DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete watched repo" }, { status: 500 })
  }
}
