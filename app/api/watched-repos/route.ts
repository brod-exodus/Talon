import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { supabase } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeRepo, parseIntervalHours, readJsonObject } from "@/lib/validation"

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { data, error } = await supabase
      .from("watched_repos")
      .select("*")
      .eq("team_id", teamId)
      .order("created_at", { ascending: false })
    if (error) throw error
    return NextResponse.json(data ?? [])
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[watched-repos] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch watched repos" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
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
        team_id: teamId,
        repo: normalizedRepo,
        interval_hours: normalizedInterval,
        active: true,
        last_checked_at: null,
      })
      .select()
      .single()
    if (error) throw error

    await recordAuditEvent({
      request,
      action: "watched_repo.create",
      outcome: "success",
      metadata: { watchedRepoId: data.id, teamSlug, repo: normalizedRepo, intervalHours: normalizedInterval },
    })
    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[watched-repos] POST error:", error)
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Repo is already being watched" }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to add watched repo" }, { status: 500 })
  }
}
