import { type NextRequest, NextResponse } from "next/server"
import { createGitHubClient } from "@/lib/github"
import { createScrape } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const type = body.type
    const target = body.target?.trim()
    const token = body.token
    const minContributions: number = Math.max(1, Math.floor(Number(body.minContributions) || 1))

    if (!type || !target) {
      return NextResponse.json({ error: "Missing type or target" }, { status: 400 })
    }

    if (!token) {
      return NextResponse.json({ error: "Missing GitHub token" }, { status: 400 })
    }

    const githubClient = createGitHubClient(token)
    const rateLimit = await githubClient.getRateLimit()
    const remaining = rateLimit.resources.core.remaining

    if (remaining < 100) {
      return NextResponse.json(
        { error: "Rate limit too low. Please wait before starting a new scrape." },
        { status: 429 },
      )
    }

    const scrapeId = `scrape-${Date.now()}-${Math.random().toString(36).substring(7)}`
    await createScrape(scrapeId, type, target, minContributions)

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
