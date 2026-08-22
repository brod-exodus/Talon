import { NextResponse } from "next/server"

const INTERNAL_ERROR_MESSAGES = {
  auth_password_update_failed: "Failed to update password.",
  auth_signup_failed: "Could not create account.",
  outreach_update_failed: "Failed to update contributor",
  profile_photo_remove_failed: "Failed to remove profile photo",
  profile_photo_upload_failed: "Failed to upload profile photo",
  profile_update_failed: "Failed to update profile",
  scrape_enqueue_failed: "Failed to start scrape",
  scrape_read_failed: "Failed to get scrape status",
  share_create_failed: "Failed to create share",
  share_list_failed: "Failed to list share links",
  share_public_read_failed: "Failed to fetch share",
  share_revoke_failed: "Failed to revoke share link",
  slack_test_failed: "Failed to send test message",
  team_member_remove_failed: "Failed to remove team member",
  team_member_save_failed: "Failed to save team member",
  team_member_update_failed: "Failed to update team member",
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
