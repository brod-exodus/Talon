import { after, type NextRequest, NextResponse } from "next/server"
import { hasCronSecret } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { enqueueDueWatchedRepoScrapes } from "@/lib/db"
import { logError, logInfo } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { runScrapeWorkerOperation } from "@/lib/scrape-worker-operation"
import { finishSystemRun, startSystemRun } from "@/lib/system-runs"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

export const maxDuration = 60

function scheduleImmediateWorker(input: {
  teamId?: string
  teamSlug?: string
  requestId: string
}) {
  after(async () => {
    try {
      await runScrapeWorkerOperation({
        trigger: "queue",
        teamId: input.teamId,
        teamSlug: input.teamSlug,
        requestId: input.requestId,
      })
    } catch (error) {
      logError("watched_repos.worker_dispatch_failed", error, {
        requestId: input.requestId,
        teamId: input.teamId,
      })
    }
  })
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  const isCronRequest = hasCronSecret(request)
  let teamId: string | undefined
  let teamSlug: string | undefined

  if (!isCronRequest) {
    const authError = await requirePermission(request, "write")
    if (authError) return authError
    try {
      const team = await resolveTeamContext(request)
      teamId = team.teamId
      teamSlug = team.teamSlug
    } catch (error) {
      return teamContextError(error)
    }
  }

  const trigger = isCronRequest ? "cron" : "manual"
  const systemRunId = await startSystemRun("watched_repos", { trigger, teamSlug }, requestId)

  try {
    const checks = await enqueueDueWatchedRepoScrapes({
      teamId,
      force: !isCronRequest,
      requestId,
    })
    const queued = checks.filter((check) => !check.replayed).length

    if (checks.length > 0) scheduleImmediateWorker({ teamId, teamSlug, requestId })

    await recordAuditEvent({
      request,
      action: "watched_repo.check",
      outcome: "success",
      teamId,
      metadata: { trigger, teamSlug, queued, alreadyActive: checks.length - queued },
    })
    await finishSystemRun(systemRunId, "success", {
      queued,
      alreadyActive: checks.length - queued,
    })
    logInfo("watched_repos.checks_queued", {
      requestId,
      systemRunId,
      teamId,
      details: { trigger, queued, alreadyActive: checks.length - queued },
    })

    return NextResponse.json(
      {
        status: "queued",
        queued,
        alreadyActive: checks.length - queued,
        checks,
      },
      { status: 202 }
    )
  } catch (error) {
    await finishSystemRun(systemRunId, "failure", { trigger }, error)
    logError("watched_repos.enqueue_failed", error, { requestId, systemRunId, teamId })
    if (error instanceof Error && error.message.includes("Default team is missing")) {
      return teamContextError(error)
    }
    return NextResponse.json({ error: "Failed to queue watched repository checks" }, { status: 500 })
  }
}
