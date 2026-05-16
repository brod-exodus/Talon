import { randomBytes } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { createSharedScrape } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeScrapeId, readJsonObject } from "@/lib/validation"

function randomToken(): string {
  return randomBytes(24).toString("base64url")
}

export async function POST(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
    const body = await readJsonObject(request)
    const scrapeId = normalizeScrapeId(body?.scrapeId)
    if (!body || !scrapeId) {
      return NextResponse.json({ error: "Missing or invalid scrapeId" }, { status: 400 })
    }

    let token = ""
    for (let attempt = 0; attempt < 3; attempt++) {
      token = randomToken()
      try {
        await createSharedScrape(scrapeId, token, teamId)
        break
      } catch (error) {
        if (attempt === 2) throw error
      }
    }

    await recordAuditEvent({
      request,
      action: "share.create",
      outcome: "success",
      metadata: { scrapeId, teamSlug },
    })
    return NextResponse.json({ token })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[share] Failed to create share:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create share" },
      { status: 500 }
    )
  }
}
