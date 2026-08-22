import { randomBytes } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { recordAuditEvent } from "@/lib/audit"
import { createSharedScrape, listSharedScrapeLinks, revokeSharedScrapeLink } from "@/lib/db"
import { logError } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import {
  DEFAULT_SHARE_EXPIRY_DAYS,
  normalizeShareExpiryDays,
  shareExpiresAt,
} from "@/lib/share-links"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeScrapeId, normalizeShareId, readJsonObject } from "@/lib/validation"

function randomToken(): string {
  return randomBytes(24).toString("base64url")
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId, teamSlug } = await resolveTeamContext(request)
    const body = await readJsonObject(request)
    const scrapeId = normalizeScrapeId(body?.scrapeId)
    const expiresInDays = normalizeShareExpiryDays(body?.expiresInDays ?? DEFAULT_SHARE_EXPIRY_DAYS)
    const allowDownload = body?.allowDownload === true
    if (!body || !scrapeId || !expiresInDays) {
      return NextResponse.json({ error: "Missing or invalid share settings" }, { status: 400 })
    }

    const token = randomToken()
    const share = await createSharedScrape(
      scrapeId,
      token,
      { expiresAt: shareExpiresAt(expiresInDays), allowDownload },
      teamId
    )

    await recordAuditEvent({
      request,
      action: "share.create",
      outcome: "success",
      teamId,
      metadata: { scrapeId, teamSlug, shareId: share.id, expiresAt: share.expiresAt, allowDownload },
    })
    return NextResponse.json({ token, share })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message === "Scrape not found") {
      return NextResponse.json({ error: "Scrape not found" }, { status: 404 })
    }
    logError("share.create_failed", error, { requestId })
    return internalErrorResponse("share_create_failed", requestId)
  }
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const scrapeId = normalizeScrapeId(request.nextUrl.searchParams.get("scrapeId"))
    if (!scrapeId) return NextResponse.json({ error: "Missing or invalid scrapeId" }, { status: 400 })
    return NextResponse.json({ shares: await listSharedScrapeLinks(scrapeId, teamId) })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    logError("share.list_failed", error, { requestId })
    return internalErrorResponse("share_list_failed", requestId)
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const team = await resolveTeamContext(request)
    const body = await readJsonObject(request)
    const shareId = normalizeShareId(body?.shareId)
    if (!shareId) return NextResponse.json({ error: "Missing or invalid shareId" }, { status: 400 })

    const share = await revokeSharedScrapeLink(shareId, team.teamId)
    if (!share) return NextResponse.json({ error: "Active share link not found" }, { status: 404 })

    await recordAuditEvent({
      request,
      action: "share.revoke",
      outcome: "success",
      actor: team.actor,
      teamId: team.teamId,
      metadata: { shareId, scrapeId: share.scrapeId, teamSlug: team.teamSlug },
    })
    return NextResponse.json({ share })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    logError("share.revoke_failed", error, { requestId })
    return internalErrorResponse("share_revoke_failed", requestId)
  }
}
