import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { addScrapeToEcosystem, getEcosystem, removeScrapeFromEcosystem } from "@/lib/db"
import { logError } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeScrapeId, normalizeUuid, readJsonObject } from "@/lib/validation"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id } = await params
    const ecosystemId = normalizeUuid(id)
    if (!ecosystemId) {
      return NextResponse.json({ error: "Invalid project id" }, { status: 400 })
    }

    const ecosystem = await getEcosystem(ecosystemId, teamId)
    if (!ecosystem) return NextResponse.json({ error: "Project not found" }, { status: 404 })
    return NextResponse.json({ scrapes: ecosystem.scrapes })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    logError("ecosystem_scrapes.read_failed", error, { requestId })
    return internalErrorResponse("ecosystem_scrape_read_failed", requestId)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id: ecosystemId } = await params
    const body = await readJsonObject(request)
    const normalizedEcosystemId = normalizeUuid(ecosystemId)
    const scrapeId = normalizeScrapeId(body?.scrapeId)
    if (!body || !normalizedEcosystemId || !scrapeId) {
      return NextResponse.json({ error: "Missing or invalid project id or scrapeId" }, { status: 400 })
    }
    await addScrapeToEcosystem(normalizedEcosystemId, scrapeId, teamId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Scrape is already in this project" }, { status: 409 })
    }
    logError("ecosystem_scrapes.add_failed", error, { requestId })
    return internalErrorResponse("ecosystem_scrape_add_failed", requestId)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const { id: ecosystemId } = await params
    const body = await readJsonObject(request)
    const normalizedEcosystemId = normalizeUuid(ecosystemId)
    const scrapeId = normalizeScrapeId(body?.scrapeId)
    if (!body || !normalizedEcosystemId || !scrapeId) {
      return NextResponse.json({ error: "Missing or invalid project id or scrapeId" }, { status: 400 })
    }
    await removeScrapeFromEcosystem(normalizedEcosystemId, scrapeId, teamId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    logError("ecosystem_scrapes.remove_failed", error, { requestId })
    return internalErrorResponse("ecosystem_scrape_remove_failed", requestId)
  }
}
