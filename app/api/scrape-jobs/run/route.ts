import { type NextRequest, NextResponse } from "next/server"
import { hasCronSecret } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { requirePermission } from "@/lib/permissions"
import { runScrapeWorker } from "@/lib/scrape-worker"
import { finishSystemRun, startSystemRun } from "@/lib/system-runs"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

const MAX_JOBS_PER_INVOCATION = 1
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const isCronRequest = hasCronSecret(request)
  let teamId: string | undefined
  let teamSlug: string | undefined
  if (!isCronRequest) {
    const authError = requirePermission(request, "write")
    if (authError) return authError
    try {
      const team = await resolveTeamContext(request)
      teamId = team.teamId
      teamSlug = team.teamSlug
    } catch (error) {
      return teamContextError(error)
    }
  }

  const systemRunId = await startSystemRun("scrape_worker", {
    trigger: isCronRequest ? "cron" : "manual",
    teamSlug,
  })
  try {
    const { workerId, recoveredStaleJobs, results } = await runScrapeWorker(MAX_JOBS_PER_INVOCATION, teamId)
    const hasFailedResult = results.some((result) => result.status === "failed")
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
      steps: results.reduce((total, result) => total + (result.steps ?? 0), 0),
      maxElapsedMs: Math.max(0, ...results.map((result) => result.elapsedMs ?? 0)),
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

    await finishSystemRun(systemRunId, hasFailedResult ? "failure" : "success", {
      workerId,
      recoveredStaleJobs,
      processed: results.length,
      statuses: results.map((result) => result.status),
      steps: results.reduce((total, result) => total + (result.steps ?? 0), 0),
      maxElapsedMs: Math.max(0, ...results.map((result) => result.elapsedMs ?? 0)),
    })
    return NextResponse.json({ workerId, recoveredStaleJobs, processed: results.length, results })
  } catch (error) {
    await finishSystemRun(systemRunId, "failure", {}, error)
    throw error
  }
}
