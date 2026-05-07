import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getEcosystem, deleteEcosystem } from "@/lib/db"
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
    const ecosystem = await getEcosystem(ecosystemId)
    if (!ecosystem) {
      return NextResponse.json({ error: "Ecosystem not found" }, { status: 404 })
    }
    return NextResponse.json({ ecosystem })
  } catch (error) {
    console.error("[ecosystems/[id]] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch ecosystem" }, { status: 500 })
  }
}

export async function DELETE(
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
    await deleteEcosystem(ecosystemId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[ecosystems/[id]] DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete ecosystem" }, { status: 500 })
  }
}
