import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { addScrapeToEcosystem, removeScrapeFromEcosystem } from "@/lib/db"
import { normalizeScrapeId, normalizeUuid, readJsonObject } from "@/lib/validation"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { id: ecosystemId } = await params
    const body = await readJsonObject(request)
    const normalizedEcosystemId = normalizeUuid(ecosystemId)
    const scrapeId = normalizeScrapeId(body?.scrapeId)
    if (!body || !normalizedEcosystemId || !scrapeId) {
      return NextResponse.json({ error: "Missing or invalid ecosystem id or scrapeId" }, { status: 400 })
    }
    await addScrapeToEcosystem(normalizedEcosystemId, scrapeId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[ecosystems/[id]/scrapes] POST error:", error)
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Scrape is already in this ecosystem" }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to add scrape" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { id: ecosystemId } = await params
    const body = await readJsonObject(request)
    const normalizedEcosystemId = normalizeUuid(ecosystemId)
    const scrapeId = normalizeScrapeId(body?.scrapeId)
    if (!body || !normalizedEcosystemId || !scrapeId) {
      return NextResponse.json({ error: "Missing or invalid ecosystem id or scrapeId" }, { status: 400 })
    }
    await removeScrapeFromEcosystem(normalizedEcosystemId, scrapeId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[ecosystems/[id]/scrapes] DELETE error:", error)
    return NextResponse.json({ error: "Failed to remove scrape" }, { status: 500 })
  }
}
