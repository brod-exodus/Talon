import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getScrapes } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { active, failed, completed } = await getScrapes(teamId)
    return NextResponse.json({ active, failed, completed })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[v0] Failed to fetch scrapes:", error)
    return NextResponse.json({ error: "Failed to fetch scrapes", active: [], failed: [], completed: [] }, { status: 500 })
  }
}
