import { randomBytes } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { recordAuditEvent } from "@/lib/audit"
import { createSharedScrape, deleteSharedScrape, getSharedScrapeTokenForScrape } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeScrapeId, normalizeShareToken, readJsonObject } from "@/lib/validation"

function randomToken(): string {
  return randomBytes(24).toString("base64url")
}

export async function POST(request: NextRequest) {
  const authError = requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
    const body = await readJsonObject(request)
    const scrapeId = normalizeScrapeId(body?.scrapeId)
    if (!body || !scrapeId) {
      return NextResponse.json({ error: "Missing or invalid scrapeId" }, { status: 400 })
    }

    const existingToken = await getSharedScrapeTokenForScrape(scrapeId, teamId)
    if (existingToken) {
      return NextResponse.json({ token: existingToken, created: false })
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
    return NextResponse.json({ token, created: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[share] Failed to create share:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create share" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const authError = requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
    const body = await readJsonObject(request)
    const scrapeId = normalizeScrapeId(body?.scrapeId)
    const token = normalizeShareToken(body?.token)
    if (!body || !scrapeId || !token) {
      return NextResponse.json({ error: "Missing or invalid scrapeId or token" }, { status: 400 })
    }

    const deleted = await deleteSharedScrape(token, scrapeId, teamId)
    if (!deleted) {
      return NextResponse.json({ error: "Share link not found" }, { status: 404 })
    }

    await recordAuditEvent({
      request,
      action: "share.revoke",
      outcome: "success",
      metadata: { scrapeId, teamSlug },
    })
    return NextResponse.json({ revoked: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[share] Failed to revoke share:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to revoke share" },
      { status: 500 }
    )
  }
}
