import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getEcosystemContributors } from "@/lib/db"
import { normalizeUuid } from "@/lib/validation"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireAuth(_request)
  if (authError) return authError

  try {
    const { id } = await params
    const ecosystemId = normalizeUuid(id)
    if (!ecosystemId) {
      return NextResponse.json({ error: "Invalid ecosystem id" }, { status: 400 })
    }
    const contributors = await getEcosystemContributors(ecosystemId)
    return NextResponse.json({ contributors })
  } catch (error) {
    console.error("[ecosystems/[id]/contributors] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch ecosystem contributors" }, { status: 500 })
  }
}
