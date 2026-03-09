import { type NextRequest, NextResponse } from "next/server"
import { addScrapeToEcosystem, removeScrapeFromEcosystem } from "@/lib/db"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ecosystemId } = await params
    const { scrapeId } = await request.json()
    if (!scrapeId) {
      return NextResponse.json({ error: "Missing scrapeId" }, { status: 400 })
    }
    await addScrapeToEcosystem(ecosystemId, scrapeId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[ecosystems/[id]/scrapes] POST error:", error)
    return NextResponse.json({ error: "Failed to add scrape" }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ecosystemId } = await params
    const { scrapeId } = await request.json()
    if (!scrapeId) {
      return NextResponse.json({ error: "Missing scrapeId" }, { status: 400 })
    }
    await removeScrapeFromEcosystem(ecosystemId, scrapeId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[ecosystems/[id]/scrapes] DELETE error:", error)
    return NextResponse.json({ error: "Failed to remove scrape" }, { status: 500 })
  }
}
