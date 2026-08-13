import { type NextRequest, NextResponse } from "next/server"
import { hasCronSecret } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { runScrapeWorkerOperation } from "@/lib/scrape-worker-operation"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

const MAX_JOBS_PER_INVOCATION = 1
export const maxDuration = 60

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

  const {
    workerId,
    recoveredStaleJobs,
    results,
    hasFailedResult,
    steps,
    maxElapsedMs,
  } = await runScrapeWorkerOperation({
    trigger: isCronRequest ? "cron" : "manual",
    teamId,
    teamSlug,
    maxJobs: MAX_JOBS_PER_INVOCATION,
    requestId,
  })

  await recordAuditEvent({
    request,
    action: "scrape_worker.run",
    outcome: hasFailedResult ? "failure" : "success",
    actor: isCronRequest ? "cron" : "admin",
    teamId,
    metadata: {
      workerId,
      teamSlug,
      processed: results.length,
      statuses: results.map((result) => result.status),
      steps,
      maxElapsedMs,
    },
  })
  for (const result of results) {
    if (result.status !== "failed") continue
    await recordAuditEvent({
      request,
      action: "scrape.failure",
      outcome: "failure",
      actor: isCronRequest ? "cron" : "admin",
      teamId: result.teamId,
      metadata: {
        workerId,
        jobId: result.jobId,
        scrapeId: result.scrapeId,
        teamId: result.teamId,
        error: result.error ?? "Unknown scrape job error",
      },
    })
  }

  return NextResponse.json({ workerId, recoveredStaleJobs, processed: results.length, results })
}
