import { randomUUID } from "node:crypto"
import { after, type NextRequest, NextResponse } from "next/server"
import { recordAuditEvent } from "@/lib/audit"
import { recordActivityEvent } from "@/lib/activity"
import { createGitHubClient } from "@/lib/github"
import { addScrapeToEcosystem, createScrape, createScrapeJob, ecosystemExists } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { runScrapeWorkerOperation } from "@/lib/scrape-worker-operation"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import {
  normalizeScrapeTarget,
  normalizeUuid,
  parseMinContributions,
  parseScrapeType,
  readJsonObject,
} from "@/lib/validation"

export const maxDuration = 60

function githubTargetNotFoundResponse(type: "organization" | "repository", target: string) {
  const label = type === "repository" ? "Repository" : "Organization"
  const guidance =
    type === "repository"
      ? `Repository not found or not accessible. Check the owner/repo name or GitHub token permissions. We couldn't find "${target}" on GitHub.`
      : `We couldn't find "${target}" on GitHub. Check the organization spelling. If this is private, make sure your GitHub token has access.`

  return NextResponse.json(
    {
      code: "github_target_not_found",
      type,
      target,
      message: guidance,
      error: `${label} not found`,
    },
    { status: 404 }
  )
}

export async function POST(request: NextRequest) {
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId, teamSlug, email } = await resolveTeamContext(request)
    const body = await readJsonObject(request)
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const type = parseScrapeType(body.type)
    const target = type ? normalizeScrapeTarget(type, body.target) : null
    const minContributions = parseMinContributions(body.minContributions)
    const rawProjectId = typeof body.projectId === "string" ? body.projectId.trim() : ""
    const projectId = rawProjectId ? normalizeUuid(rawProjectId) : null

    if (!type || !target) {
      return NextResponse.json({ error: "Missing or invalid type or target" }, { status: 400 })
    }

    if (rawProjectId && !projectId) {
      return NextResponse.json({ error: "Missing or invalid projectId" }, { status: 400 })
    }

    const token = process.env.GITHUB_TOKEN?.trim()
    if (!token) {
      return NextResponse.json(
        { error: "GitHub access is not configured. Set GITHUB_TOKEN in the deployment environment." },
        { status: 503 }
      )
    }

    if (projectId) {
      const projectFound = await ecosystemExists(projectId, teamId)
      if (!projectFound) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 })
      }
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

    const targetExists =
      type === "repository"
        ? await githubClient.repositoryExists(target)
        : await githubClient.organizationExists(target)

    if (!targetExists) {
      return githubTargetNotFoundResponse(type, target)
    }

    const scrapeId = `scrape-${randomUUID()}`
    await createScrape(scrapeId, type, target, minContributions, teamId)
    if (projectId) {
      await addScrapeToEcosystem(projectId, scrapeId, teamId)
    }
    const job = await createScrapeJob(scrapeId, type, target, minContributions, teamId)
    await recordActivityEvent({
      teamId,
      actorEmail: email,
      type: "scrape.started",
      title: "Scrape started",
      description: `${type === "repository" ? "Repository" : "Organization"} scrape for ${target}`,
      metadata: { scrapeId, type, target, minContributions, projectId },
    })
    await recordAuditEvent({
      request,
      action: "scrape.start",
      outcome: "success",
      teamId,
      metadata: { scrapeId, jobId: job.id, teamSlug, type, target, minContributions, projectId },
    })

    // Return the durable queue response first, then immediately give the worker
    // a chance to claim it. Supabase Cron remains the recovery path if this
    // post-response invocation is interrupted or another worker owns the job.
    after(async () => {
      try {
        await runScrapeWorkerOperation({ trigger: "queue", teamId, teamSlug })
      } catch (error) {
        console.error("[scrape-dispatch] Immediate worker invocation failed; cron will retry:", error)
      }
    })

    return NextResponse.json(
      {
        scrapeId,
        jobId: job.id,
        status: "queued",
        dispatch: "immediate",
        message: "Scrape queued",
        rateLimit: {
          limit: rateLimit.resources.core.limit,
          remaining: rateLimit.resources.core.remaining,
        },
      },
      { status: 202 }
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[v0] Scrape error:", error)

    const extractedError =
      error instanceof Error
        ? error.message
        : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
          ? error.message
          : "Failed to start scrape"
    return NextResponse.json(
      { error: extractedError },
      { status: 500 },
    )
  }
}
