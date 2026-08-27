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
  scrape_delete_failed: "Failed to delete scrape",
  scrape_job_cancel_failed: "Failed to cancel scrape job",
  scrape_job_list_failed: "Failed to fetch scrape jobs",
  scrape_job_retry_failed: "Failed to retry scrape job",
  scrape_job_timeline_failed: "Failed to fetch scrape job timeline",
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
  watched_repo_check_failed: "Failed to queue watched repository checks",
  github_rate_limit_check_failed: "Failed to check rate limit",
  workspace_lifecycle_preview_failed: "Failed to preview workspace data",
  workspace_export_failed: "Failed to export workspace data",
  workspace_delete_failed: "Failed to delete workspace data",
} as const

const SERVICE_ERROR_MESSAGES = {
  auth_logout_revoke_unavailable: { message: "Signed out locally, but the server session could not be revoked.", status: 503 },
  auth_password_session_revoke_unavailable: { message: "Password changed, but existing sessions could not be revoked. Contact an administrator.", status: 503 },
  auth_password_reset_session_revoke_unavailable: { message: "Password recovery could not be completed safely. Request a new link and try again.", status: 503 },
  auth_password_reset_unavailable: { message: "Password recovery is temporarily unavailable. Request a new link and try again.", status: 503 },
  auth_password_recovery_disabled: { message: "Password recovery is not configured. Contact a Talon administrator.", status: 503 },
  auth_session_list_unavailable: { message: "Could not load active sessions.", status: 503 },
  auth_session_revoke_unavailable: { message: "Could not revoke active sessions.", status: 503 },
  github_credentials_invalid: { message: "The configured GitHub token is invalid.", status: 502 },
  github_not_configured: { message: "GitHub access is not configured. Set GITHUB_TOKEN in the deployment environment.", status: 503 },
  keepalive_auth_session_retention_failed: { message: "Auth session retention cleanup failed", status: 500 },
  keepalive_database_check_failed: { message: "Supabase keepalive query failed", status: 500 },
  keepalive_failed: { message: "Supabase keepalive failed", status: 500 },
  keepalive_notification_retention_failed: { message: "Notification retention cleanup failed", status: 500 },
  keepalive_retention_failed: { message: "Supabase retention cleanup failed", status: 500 },
  keepalive_run_persist_failed: { message: "Supabase keepalive status recording failed", status: 500 },
  profile_photo_storage_not_ready: { message: "Profile photo storage is not ready. Apply db/migrations/012_team_profile_photos.sql.", status: 500 },
  profile_storage_not_ready: { message: "Profile storage is not ready. Apply db/migrations/012_team_profile_photos.sql.", status: 500 },
  project_tracking_migration_missing: { message: "Project outreach tracking is not installed. Apply db/migrations/017_project_contributor_tracking.sql in Supabase, then redeploy or retry.", status: 503 },
  project_tracking_fetch_failed: { message: "Project tracking could not load. Check server logs for Supabase error details.", status: 500 },
  project_tracking_update_failed: { message: "Failed to update project tracking", status: 500 },
  project_tracking_schema_outdated: { message: "Project outreach tracking schema is out of date. Re-run db/migrations/017_project_contributor_tracking.sql in Supabase.", status: 503 },
  project_tracking_unique_constraint_missing: { message: "Project outreach tracking is missing its project/contributor unique constraint. Re-run db/migrations/017_project_contributor_tracking.sql in Supabase.", status: 503 },
  workspace_export_too_large: { message: "This workspace is too large for an immediate export. Contact the Talon operator.", status: 413 },
  workspace_delete_active_work: { message: "This workspace still has active work. Wait for it to finish or cancel it, then refresh the preview.", status: 409 },
  slack_webhook_rejected: { message: "Slack rejected the webhook request. Please check the URL.", status: 502 },
} as const

export type InternalErrorCode = keyof typeof INTERNAL_ERROR_MESSAGES
export type ServiceErrorCode = keyof typeof SERVICE_ERROR_MESSAGES

export function internalErrorResponse(code: InternalErrorCode, requestId: string): NextResponse {
  return NextResponse.json(
    { error: INTERNAL_ERROR_MESSAGES[code], requestId },
    {
      status: 500,
      headers: { "Cache-Control": "private, no-store" },
    }
  )
}

export function serviceErrorResponse(code: ServiceErrorCode, requestId: string): NextResponse {
  const error = SERVICE_ERROR_MESSAGES[code]
  return NextResponse.json(
    { error: error.message, code, requestId },
    {
      status: error.status,
      headers: { "Cache-Control": "private, no-store" },
    }
  )
}
