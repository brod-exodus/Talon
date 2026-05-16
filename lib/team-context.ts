import { type NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

const DEFAULT_TEAM_SLUG = "default"

let cachedDefaultTeamId: string | null = null

export type TeamContext = {
  teamId: string
  teamSlug: string
}

export async function getDefaultTeamId(): Promise<string> {
  if (cachedDefaultTeamId) return cachedDefaultTeamId

  const { data, error } = await supabaseAdmin
    .from("teams")
    .select("id")
    .eq("slug", DEFAULT_TEAM_SLUG)
    .maybeSingle()
  if (error) throw error
  if (!data?.id) throw new Error("Default team is missing. Apply db/migrations/008_team_foundation.sql.")

  cachedDefaultTeamId = data.id
  return data.id
}

export async function resolveTeamContext(request: NextRequest): Promise<TeamContext> {
  void request

  return {
    teamId: await getDefaultTeamId(),
    teamSlug: DEFAULT_TEAM_SLUG,
  }
}

export function teamContextError(error: unknown): NextResponse {
  console.error("[team-context] Failed to resolve team:", error)
  return NextResponse.json({ error: "Failed to resolve team context" }, { status: 500 })
}
