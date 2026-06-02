import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { addScrapeToEcosystem, getEcosystem, removeScrapeFromEcosystem } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeScrapeId, normalizeUuid, readJsonObject } from "@/lib/validation"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(request)
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
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[ecosystems/[id]/scrapes] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch project scrapes", scrapes: [] }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requirePermission(request, "write")
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
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[ecosystems/[id]/scrapes] POST error:", error)
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Scrape is already in this project" }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to add scrape" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requirePermission(request, "write")
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
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[ecosystems/[id]/scrapes] DELETE error:", error)
    return NextResponse.json({ error: "Failed to remove scrape" }, { status: 500 })
  }
}
