import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { normalizeUuid } from "@/lib/validation"

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { id } = await params
    const watchedRepoId = normalizeUuid(id)
    if (!watchedRepoId) {
      return NextResponse.json({ error: "Invalid watched repo id" }, { status: 400 })
    }

    // Remove linked contributor tracking rows first
    await supabase.from("watched_repo_contributors").delete().eq("watched_repo_id", watchedRepoId)

    const { error } = await supabase.from("watched_repos").delete().eq("id", watchedRepoId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[watched-repos] DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete watched repo" }, { status: 500 })
  }
}
