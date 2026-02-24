import { type NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    // Remove linked contributor tracking rows first
    await supabase.from("watched_repo_contributors").delete().eq("watched_repo_id", id)

    const { error } = await supabase.from("watched_repos").delete().eq("id", id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[watched-repos] DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete watched repo" }, { status: 500 })
  }
}
