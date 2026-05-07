import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getScrapeJobSummaries } from "@/lib/db"

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const jobs = await getScrapeJobSummaries()
    return NextResponse.json({ jobs })
  } catch (error) {
    console.error("[scrape-jobs] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch scrape jobs" }, { status: 500 })
  }
}

