import { type NextRequest, NextResponse } from "next/server"
import { updateContributorOutreach } from "@/lib/db"

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const username = body.username as string | undefined
    if (!username || typeof username !== "string") {
      return NextResponse.json({ error: "Missing or invalid username" }, { status: 400 })
    }

    const updates: {
      contacted?: boolean
      contacted_date?: string | null
      outreach_notes?: string | null
      status?: string | null
    } = {}
    if (typeof body.contacted === "boolean") updates.contacted = body.contacted
    if (body.contactedDate !== undefined) updates.contacted_date = body.contactedDate ?? null
    if (body.notes !== undefined) updates.outreach_notes = body.notes ?? null
    if (body.status !== undefined) updates.status = body.status ?? null

    await updateContributorOutreach(username, updates)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Update contributor outreach error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update contributor" },
      { status: 500 }
    )
  }
}
