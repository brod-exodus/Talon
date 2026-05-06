import { randomBytes } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { createSharedScrape } from "@/lib/db"
import { normalizeScrapeId, readJsonObject } from "@/lib/validation"

function randomToken(): string {
  return randomBytes(24).toString("base64url")
}

export async function POST(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const body = await readJsonObject(request)
    const scrapeId = normalizeScrapeId(body?.scrapeId)
    if (!body || !scrapeId) {
      return NextResponse.json({ error: "Missing or invalid scrapeId" }, { status: 400 })
    }

    let token = ""
    for (let attempt = 0; attempt < 3; attempt++) {
      token = randomToken()
      try {
        await createSharedScrape(scrapeId, token)
        break
      } catch (error) {
        if (attempt === 2) throw error
      }
    }

    return NextResponse.json({ token })
  } catch (error) {
    console.error("[share] Failed to create share:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create share" },
      { status: 500 }
    )
  }
}
