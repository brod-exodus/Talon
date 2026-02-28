import { type NextRequest, NextResponse } from "next/server"
import { getSharedScrape } from "@/lib/db"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const scrape = await getSharedScrape(token)
    if (!scrape) {
      return NextResponse.json({ error: "Share not found" }, { status: 404 })
    }
    return NextResponse.json(scrape)
  } catch (error) {
    console.error("[share] Failed to fetch shared scrape:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch share" },
      { status: 500 }
    )
  }
}
