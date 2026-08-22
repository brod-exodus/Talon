import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { recordAuditEvent } from "@/lib/audit"
import {
  getContactableScrapeContributorsPage,
  getScrapeMetadata,
  getScrapeContributorsPage,
  deleteScrape,
} from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeScrapeId } from "@/lib/validation"
import { getRequestId } from "@/lib/request-id"
import { logError } from "@/lib/logger"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id } = await params
    const scrapeId = normalizeScrapeId(id)
    if (!scrapeId) {
      return NextResponse.json({ error: "Invalid scrape id" }, { status: 400 })
    }
    const pageParam = request.nextUrl.searchParams.get("page")

    // Paginated path: used by the UI when loading contributor details.
    // Uses getScrapeMetadata (scrapes table only) to avoid the unbounded
    // .in() query that getScrape() runs against the contributors table.
    if (pageParam !== null) {
      const page = Math.max(1, parseInt(pageParam, 10) || 1)
      const pageSizeParam = request.nextUrl.searchParams.get("pageSize")
      const pageSize = Math.min(500, Math.max(1, parseInt(pageSizeParam ?? "", 10) || 100))
      const contactableOnly = request.nextUrl.searchParams.get("contactableOnly") === "true"
      const scrape = await getScrapeMetadata(scrapeId, teamId)
      if (!scrape) {
        return NextResponse.json({ error: "Scrape not found" }, { status: 404 })
      }
      const pageData = contactableOnly
        ? await getContactableScrapeContributorsPage(scrapeId, page, pageSize, teamId)
        : await getScrapeContributorsPage(scrapeId, page, pageSize, teamId, true)
      return NextResponse.json({
        id: scrape.id,
        type: scrape.type,
        target: scrape.target,
        status: scrape.status,
        progress: scrape.progress,
        current: scrape.current,
        total: scrape.total,
        currentUser: scrape.currentUser,
        startedAt: scrape.startedAt,
        completedAt: scrape.completedAt,
        error: scrape.error,
        contributors: pageData.contributors,
        contributorTotal: pageData.contributorTotal,
        page: pageData.page,
        hasMore: pageData.hasMore,
      })
    }

    return NextResponse.json({ error: "Missing required query parameter: page" }, { status: 400 })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    logError("scrape.read_failed", error, { requestId })
    return internalErrorResponse("scrape_read_failed", requestId)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id } = await params
    const scrapeId = normalizeScrapeId(id)
    if (!scrapeId) {
      return NextResponse.json({ error: "Invalid scrape id" }, { status: 400 })
    }
    await deleteScrape(scrapeId, teamId)
    await recordAuditEvent({
      request,
      action: "scrape.delete",
      outcome: "success",
      teamId,
      metadata: { scrapeId },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    logError("scrape.delete_failed", error, { requestId })
    return NextResponse.json({ error: "Failed to delete scrape" }, { status: 500 })
  }
}
