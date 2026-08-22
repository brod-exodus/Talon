import { randomUUID } from "node:crypto"
import { after, type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse, serviceErrorResponse } from "@/lib/api-error-response"
import { recordAuditEvent } from "@/lib/audit"
import { recordActivityEvent } from "@/lib/activity"
import { createGitHubClient } from "@/lib/github"
import { enqueueScrape, ecosystemExists, getActiveGitHubCooldown, getScrapeEnqueueRequest } from "@/lib/db"
import { logError, logInfo } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
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

const IDEMPOTENCY_CONFLICT_MESSAGE = "Idempotency key was already used for a different scrape request"

function scheduleImmediateWorker(teamId: string, teamSlug: string, requestId: string) {
  // Supabase Cron remains the recovery path if this post-response invocation
  // is interrupted or another worker already owns the job.
  after(async () => {
    try {
      await runScrapeWorkerOperation({ trigger: "queue", teamId, teamSlug, requestId })
    } catch (error) {
      logError("scrape.worker_dispatch_failed", error, { requestId, teamId })
    }
  })
}

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
  const requestId = getRequestId(request)
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
    const idempotencyKey = normalizeUuid(request.headers.get("Idempotency-Key"))

    if (!type || !target) {
      return NextResponse.json({ error: "Missing or invalid type or target" }, { status: 400 })
    }

    if (rawProjectId && !projectId) {
      return NextResponse.json({ error: "Missing or invalid projectId" }, { status: 400 })
    }

    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "A valid Idempotency-Key header is required" },
        { status: 400 }
      )
    }

    // A retry should not consume GitHub rate limit or depend on credentials
    // still being healthy. Return the original durable resource immediately.
    const existingRequest = await getScrapeEnqueueRequest(idempotencyKey, teamId)
    if (existingRequest) {
      const sameRequest =
        existingRequest.type === type &&
        existingRequest.target === target &&
        existingRequest.minContributions === minContributions &&
        existingRequest.projectId === projectId

      if (!sameRequest) {
        return NextResponse.json({ error: IDEMPOTENCY_CONFLICT_MESSAGE }, { status: 409 })
      }

      await recordAuditEvent({
        request,
        action: "scrape.start",
        outcome: "success",
        teamId,
        metadata: {
          scrapeId: existingRequest.scrapeId,
          jobId: existingRequest.jobId,
          teamSlug,
          type,
          target,
          minContributions,
          projectId,
          replayed: true,
        },
      })
      logInfo("scrape.enqueue_replayed", {
        requestId,
        originRequestId: existingRequest.originRequestId,
        teamId,
        jobId: existingRequest.jobId,
        scrapeId: existingRequest.scrapeId,
      })
      scheduleImmediateWorker(teamId, teamSlug, requestId)

      return NextResponse.json(
        {
          scrapeId: existingRequest.scrapeId,
          jobId: existingRequest.jobId,
          status: "queued",
          dispatch: "immediate",
          replayed: true,
          message: "Existing scrape request returned",
        },
        { status: 202 }
      )
    }

    const token = process.env.GITHUB_TOKEN?.trim()
    if (!token) {
      return serviceErrorResponse("github_not_configured", requestId)
    }

    if (projectId) {
      const projectFound = await ecosystemExists(projectId, teamId)
      if (!projectFound) {
        return NextResponse.json({ error: "Project not found" }, { status: 404 })
      }
    }

    const githubCooldown = await getActiveGitHubCooldown()
    if (githubCooldown) {
      return NextResponse.json(
        {
          code: "github_cooldown",
          error: "GitHub has temporarily paused API requests. Talon will resume automatically.",
          retryAt: githubCooldown.blockedUntil,
        },
        { status: 429 }
      )
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

    const enqueueResult = await enqueueScrape({
      scrapeId: `scrape-${randomUUID()}`,
      idempotencyKey,
      type,
      target,
      minContributions,
      projectId,
      requestId,
      teamId,
    })
    if (!enqueueResult.replayed) {
      await recordActivityEvent({
        teamId,
        actorEmail: email,
        type: "scrape.started",
        title: "Scrape started",
        description: `${type === "repository" ? "Repository" : "Organization"} scrape for ${target}`,
        metadata: { scrapeId: enqueueResult.scrapeId, type, target, minContributions, projectId },
      })
    }
    await recordAuditEvent({
      request,
      action: "scrape.start",
      outcome: "success",
      teamId,
      metadata: {
        scrapeId: enqueueResult.scrapeId,
        jobId: enqueueResult.jobId,
        teamSlug,
        type,
        target,
        minContributions,
        projectId,
        replayed: enqueueResult.replayed,
      },
    })

    logInfo(enqueueResult.replayed ? "scrape.enqueue_replayed" : "scrape.enqueue_accepted", {
      requestId,
      originRequestId: enqueueResult.originRequestId,
      teamId,
      jobId: enqueueResult.jobId,
      scrapeId: enqueueResult.scrapeId,
    })
    scheduleImmediateWorker(teamId, teamSlug, requestId)

    return NextResponse.json(
      {
        scrapeId: enqueueResult.scrapeId,
        jobId: enqueueResult.jobId,
        status: "queued",
        dispatch: "immediate",
        replayed: enqueueResult.replayed,
        message: enqueueResult.replayed ? "Existing scrape request returned" : "Scrape queued",
        rateLimit: {
          limit: rateLimit.resources.core.limit,
          remaining: rateLimit.resources.core.remaining,
        },
      },
      { status: 202 }
    )
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes(IDEMPOTENCY_CONFLICT_MESSAGE)) {
      return NextResponse.json({ error: IDEMPOTENCY_CONFLICT_MESSAGE }, { status: 409 })
    }
    logError("scrape.enqueue_failed", error, { requestId })

    return internalErrorResponse("scrape_enqueue_failed", requestId)
  }
}
