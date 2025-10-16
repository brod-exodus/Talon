import { type NextRequest, NextResponse } from "next/server"
import { createGitHubClient } from "@/lib/github"
import { createScrape } from "@/lib/storage-local"

export async function POST(request: NextRequest) {
  try {
    console.log("[v0] POST /api/scrape - Request received")
    const { type, target, token } = await request.json()
    console.log("[v0] Request body:", { type, target, hasToken: !!token })

    if (!type || !target) {
      console.log("[v0] Missing type or target")
      return NextResponse.json({ error: "Missing type or target" }, { status: 400 })
    }

    if (!token) {
      console.log("[v0] Missing GitHub token")
      return NextResponse.json({ error: "Missing GitHub token" }, { status: 400 })
    }

    console.log("[v0] Creating GitHub client and checking rate limit")
    const githubClient = createGitHubClient(token)
    const rateLimit = await githubClient.getRateLimit()
    const remaining = rateLimit.resources.core.remaining
    console.log("[v0] Rate limit remaining:", remaining)

    if (remaining < 100) {
      console.log("[v0] Rate limit too low")
      return NextResponse.json(
        { error: "Rate limit too low. Please wait before starting a new scrape." },
        { status: 429 },
      )
    }

    const scrapeId = `scrape-${Date.now()}-${Math.random().toString(36).substring(7)}`
    console.log("[v0] Generated scrape ID:", scrapeId)

    await createScrape({
      id: scrapeId,
      type,
      target,
      status: "active",
      progress: 0,
      current: 0,
      total: 0,
      startedAt: new Date(),
    })
    console.log("[v0] Scrape entry created in database")

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
