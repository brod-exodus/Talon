import { randomUUID } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { createGitHubClient } from "@/lib/github"
import { createScrape, createScrapeJob } from "@/lib/db"
import { runScrapeWorker } from "@/lib/scrape-worker"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import {
  normalizeGithubToken,
  normalizeScrapeTarget,
  parseMinContributions,
  parseScrapeType,
  readJsonObject,
} from "@/lib/validation"

export async function POST(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
    const body = await readJsonObject(request)
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const type = parseScrapeType(body.type)
    const target = type ? normalizeScrapeTarget(type, body.target) : null
    const token = normalizeGithubToken(body.token)
    const minContributions = parseMinContributions(body.minContributions)

    if (!type || !target) {
      return NextResponse.json({ error: "Missing or invalid type or target" }, { status: 400 })
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

    const scrapeId = `scrape-${randomUUID()}`
    await createScrape(scrapeId, type, target, minContributions, teamId)
    await createScrapeJob(scrapeId, type, target, minContributions, teamId)
    const workerRun = await runScrapeWorker(1, teamId)
    const triggered = workerRun.results.some((result) => result.scrapeId === scrapeId)
    await recordAuditEvent({
      request,
      action: "scrape.start",
      outcome: "success",
      metadata: { scrapeId, teamSlug, type, target, minContributions, workerTriggered: triggered },
    })

    return NextResponse.json({
      scrapeId,
      message: triggered ? "Scrape started" : "Scrape queued",
      workerTriggered: triggered,
      rateLimit: {
        limit: rateLimit.resources.core.limit,
        remaining: rateLimit.resources.core.remaining,
      },
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[v0] Scrape error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start scrape" },
      { status: 500 },
    )
  }
}
