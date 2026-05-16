import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { getScrapeMetadata, getScrapeContributorsPage, deleteScrape } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeScrapeId } from "@/lib/validation"

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAuth(request)
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
      const scrape = await getScrapeMetadata(scrapeId, teamId)
      if (!scrape) {
        return NextResponse.json({ error: "Scrape not found" }, { status: 404 })
      }
      const pageData = await getScrapeContributorsPage(scrapeId, page, undefined, teamId)
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
    console.error("[v0] Get scrape error – full error:", error)
    if (error && typeof error === "object") {
      console.error("[v0] Get scrape error detail:", JSON.stringify(error, null, 2))
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get scrape status" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAuth(request)
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
      metadata: { scrapeId },
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[v0] Delete scrape error:", error)
    return NextResponse.json({ error: "Failed to delete scrape" }, { status: 500 })
  }
}
