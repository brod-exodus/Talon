import { type NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("watched_repos")
      .select("*")
      .order("created_at", { ascending: false })
    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch (error) {
    console.error("[watched-repos] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch watched repos" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { repo, interval_hours } = await request.json()

    if (!repo || typeof repo !== "string" || !repo.trim()) {
      return NextResponse.json({ error: "Missing or invalid repo (expected owner/repo)" }, { status: 400 })
    }
    if (!interval_hours || typeof interval_hours !== "number" || interval_hours <= 0) {
      return NextResponse.json({ error: "Missing or invalid interval_hours" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("watched_repos")
      .insert({
        repo: repo.trim(),
        interval_hours,
        active: true,
        last_checked_at: null,
      })
      .select()
      .single()
    if (error) throw error

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("[watched-repos] POST error:", error)
    return NextResponse.json({ error: "Failed to add watched repo" }, { status: 500 })
  }
}
