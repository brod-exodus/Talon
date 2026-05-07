import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { normalizeRepo, parseIntervalHours, readJsonObject } from "@/lib/validation"

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

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
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const body = await readJsonObject(request)
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const normalizedRepo = normalizeRepo(body.repo)
    const normalizedInterval = parseIntervalHours(body.interval_hours)

    if (!normalizedRepo) {
      return NextResponse.json({ error: "Missing or invalid repo (expected owner/repo)" }, { status: 400 })
    }
    if (!normalizedInterval) {
      return NextResponse.json({ error: "Missing or invalid interval_hours" }, { status: 400 })
    }

    const { data, error } = await supabase
      .from("watched_repos")
      .insert({
        repo: normalizedRepo,
        interval_hours: normalizedInterval,
        active: true,
        last_checked_at: null,
      })
      .select()
      .single()
    if (error) throw error

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("[watched-repos] POST error:", error)
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Repo is already being watched" }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to add watched repo" }, { status: 500 })
  }
}
