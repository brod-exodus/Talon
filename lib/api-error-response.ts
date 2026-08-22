import { NextResponse } from "next/server"

const INTERNAL_ERROR_MESSAGES = {
  outreach_update_failed: "Failed to update contributor",
  scrape_enqueue_failed: "Failed to start scrape",
  scrape_read_failed: "Failed to get scrape status",
  share_create_failed: "Failed to create share",
  share_list_failed: "Failed to list share links",
  share_public_read_failed: "Failed to fetch share",
  share_revoke_failed: "Failed to revoke share link",
} as const

export type InternalErrorCode = keyof typeof INTERNAL_ERROR_MESSAGES

export function internalErrorResponse(code: InternalErrorCode, requestId: string): NextResponse {
  return NextResponse.json(
    { error: INTERNAL_ERROR_MESSAGES[code], requestId },
    {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    }
  )
}
