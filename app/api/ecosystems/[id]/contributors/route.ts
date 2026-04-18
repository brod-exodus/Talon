import { type NextRequest, NextResponse } from "next/server"
import { getEcosystemContributors } from "@/lib/db"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const contributors = await getEcosystemContributors(id)
    return NextResponse.json({ contributors })
  } catch (error) {
    console.error("[ecosystems/[id]/contributors] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch ecosystem contributors" }, { status: 500 })
  }
}
