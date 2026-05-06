import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { getEcosystems, createEcosystem } from "@/lib/db"
import { normalizeName, readJsonObject } from "@/lib/validation"

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const ecosystems = await getEcosystems()
    return NextResponse.json(ecosystems)
  } catch (error) {
    console.error("[ecosystems] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch ecosystems" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const body = await readJsonObject(request)
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const normalizedName = normalizeName(body.name)
    if (!normalizedName) {
      return NextResponse.json({ error: "Missing or invalid name" }, { status: 400 })
    }
    const ecosystem = await createEcosystem(normalizedName)
    return NextResponse.json(ecosystem)
  } catch (error) {
    console.error("[ecosystems] POST error:", error)
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Ecosystem already exists" }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to create ecosystem" }, { status: 500 })
  }
}
