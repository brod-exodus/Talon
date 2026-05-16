import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { cancelScrapeJob } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid } from "@/lib/validation"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
    const { id } = await params
    const jobId = normalizeUuid(id)
    if (!jobId) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 })
    }

    const job = await cancelScrapeJob(jobId, "Scrape canceled", teamId)
    await recordAuditEvent({
      request,
      action: "scrape.cancel",
      outcome: "success",
      metadata: { jobId: job.id, scrapeId: job.scrapeId, teamSlug },
    })
    return NextResponse.json({ job })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[scrape-jobs] cancel error:", error)
    if (error instanceof Error && error.message.startsWith("Succeeded scrape jobs")) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to cancel scrape job" }, { status: 500 })
  }
}
