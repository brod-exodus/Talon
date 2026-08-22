import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { getSharedScrape } from "@/lib/db"
import { logError } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"
import { toPublicSharedScrape } from "@/lib/share-links"
import { normalizeShareToken } from "@/lib/validation"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const requestId = getRequestId(request)
  try {
    const { token } = await params
    const shareToken = normalizeShareToken(token)
    if (!shareToken) {
      return NextResponse.json({ error: "Invalid share token" }, { status: 400 })
    }
    const resolution = await getSharedScrape(shareToken)
    if (resolution.status === "not_found") {
      return NextResponse.json({ error: "Share not found" }, { status: 404 })
    }
    if (resolution.status !== "active") {
      return NextResponse.json(
        { error: "This share link is no longer available" },
        { status: 410, headers: { "Cache-Control": "private, no-store" } }
      )
    }
    return NextResponse.json(
      toPublicSharedScrape(resolution.scrape, {
        expiresAt: resolution.expiresAt,
        allowDownload: resolution.allowDownload,
      }),
      { headers: { "Cache-Control": "private, no-store" } }
    )
  } catch (error) {
    logError("share.public_read_failed", error, { requestId })
    return internalErrorResponse("share_public_read_failed", requestId)
  }
}
