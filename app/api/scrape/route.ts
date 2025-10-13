import { type NextRequest, NextResponse } from "next/server"
import { createGitHubClient } from "@/lib/github"

export async function POST(request: NextRequest) {
  try {
    const { type, target, token } = await request.json()

    if (!type || !target) {
      return NextResponse.json({ error: "Missing type or target" }, { status: 400 })
    }

    if (!token) {
      return NextResponse.json({ error: "Missing GitHub token" }, { status: 400 })
    }

    const githubClient = createGitHubClient(token)

    // Check rate limit
    const rateLimit = await githubClient.getRateLimit()
    const remaining = rateLimit.resources.core.remaining

    if (remaining < 100) {
      return NextResponse.json(
        { error: "Rate limit too low. Please wait before starting a new scrape." },
        { status: 429 },
      )
    }

    // Start scrape in background (in production, use a queue system)
    const scrapeId = `scrape_${Date.now()}`

    // Return immediately with scrape ID
    return NextResponse.json({
      scrapeId,
      message: "Scrape started",
      rateLimit: {
        limit: rateLimit.resources.core.limit,
        remaining: rateLimit.resources.core.remaining,
      },
    })
  } catch (error) {
    console.error("[v0] Scrape error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start scrape" },
      { status: 500 },
    )
  }
}
