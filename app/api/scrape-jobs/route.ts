import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getScrapeJobSummaries } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const jobs = await getScrapeJobSummaries(50, teamId)
    return NextResponse.json({ jobs })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[scrape-jobs] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch scrape jobs" }, { status: 500 })
  }
}
