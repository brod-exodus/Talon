import { type NextRequest, NextResponse } from "next/server"
import { getEcosystems, createEcosystem } from "@/lib/db"

export async function GET() {
  try {
    const ecosystems = await getEcosystems()
    return NextResponse.json(ecosystems)
  } catch (error) {
    console.error("[ecosystems] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch ecosystems" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json()
    if (!name?.trim()) {
      return NextResponse.json({ error: "Missing name" }, { status: 400 })
    }
    const ecosystem = await createEcosystem(name.trim())
    return NextResponse.json(ecosystem)
  } catch (error) {
    console.error("[ecosystems] POST error:", error)
    return NextResponse.json({ error: "Failed to create ecosystem" }, { status: 500 })
  }
}
