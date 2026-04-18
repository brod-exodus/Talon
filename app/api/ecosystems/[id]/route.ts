import { type NextRequest, NextResponse } from "next/server"
import { getEcosystem, deleteEcosystem } from "@/lib/db"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const ecosystem = await getEcosystem(id)
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
  try {
    const { id } = await params
    await deleteEcosystem(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[ecosystems/[id]] DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete ecosystem" }, { status: 500 })
  }
}
