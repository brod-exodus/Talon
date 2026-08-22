import { NextResponse } from "next/server"

const INTERNAL_ERROR_MESSAGES = {
  activity_list_failed: "Failed to fetch activity events",
  auth_password_update_failed: "Failed to update password.",
  auth_signup_failed: "Could not create account.",
  audit_list_failed: "Failed to fetch audit events",
  contributor_read_failed: "Failed to fetch contributor",
  contributor_update_failed: "Failed to update contributor",
  ecosystem_contributors_read_failed: "Failed to fetch project contributors",
  ecosystem_create_failed: "Failed to create project",
  ecosystem_delete_failed: "Failed to delete project",
  ecosystem_list_create_failed: "Failed to create project list",
  ecosystem_list_delete_failed: "Failed to delete project list",
  ecosystem_list_member_add_failed: "Failed to add contributor to project list",
  ecosystem_list_read_failed: "Failed to fetch project lists",
  ecosystem_list_update_failed: "Failed to rename project list",
  ecosystem_read_failed: "Failed to fetch project",
  ecosystem_scrape_add_failed: "Failed to add scrape",
  ecosystem_scrape_read_failed: "Failed to fetch project scrapes",
  ecosystem_scrape_remove_failed: "Failed to remove scrape",
  ecosystems_read_failed: "Failed to fetch projects",
  follow_up_list_failed: "Failed to fetch follow-ups",
  pipeline_read_failed: "Failed to fetch pipeline",
  outreach_update_failed: "Failed to update contributor",
  profile_photo_remove_failed: "Failed to remove profile photo",
  profile_photo_upload_failed: "Failed to upload profile photo",
  profile_update_failed: "Failed to update profile",
  scrape_enqueue_failed: "Failed to start scrape",
  scrape_job_cancel_failed: "Failed to cancel scrape job",
  scrape_job_list_failed: "Failed to fetch scrape jobs",
  scrape_job_retry_failed: "Failed to retry scrape job",
  scrape_list_active_failed: "Failed to fetch active scrapes",
  scrape_list_failed: "Failed to fetch scrapes",
  scrape_list_recent_failed: "Failed to fetch recent scrapes",
  scrape_read_failed: "Failed to get scrape status",
  search_failed: "Failed to search Talon",
  share_create_failed: "Failed to create share",
  share_list_failed: "Failed to list share links",
  share_public_read_failed: "Failed to fetch share",
  share_revoke_failed: "Failed to revoke share link",
  slack_test_failed: "Failed to send test message",
  team_member_remove_failed: "Failed to remove team member",
  team_member_save_failed: "Failed to save team member",
  team_member_update_failed: "Failed to update team member",
  watched_repo_create_failed: "Failed to add watched repo",
  watched_repo_delete_failed: "Failed to delete watched repo",
  watched_repo_list_failed: "Failed to fetch watched repos",
  github_rate_limit_check_failed: "Failed to check rate limit",
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
