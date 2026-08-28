# Talon data lifecycle contract

This is the required inventory for data Talon persists in Postgres. It ensures
retention, export, and deletion work starts from an explicit contract instead of
assuming every workspace-owned row can safely be deleted in the same way.

Public GitHub profiles and contact details are still personal data. Recruiter
notes, reminders, outreach state, account membership, security history, and
delivery errors are private Talon data and must never appear in public shares,
logs, fixtures, or portfolio demonstrations.

## Current inventory

"Automatic" means the daily authenticated keepalive invokes a database-owned
cleanup function. "Cascade" means deletion follows a parent foreign key; it is
not an independent retention schedule. "Operator" means an authorized Talon
action exists for the parent object. "Retained" means Talon currently has no
automatic expiry for that data.

| Table | Data and sensitivity | Workspace boundary | Current lifecycle |
| --- | --- | --- | --- |
| `teams` | Workspace identity and private-owner email | Root workspace record | Owner deletion cascades workspace-owned Postgres data |
| `team_memberships` | Account email and role | Workspace-owned | Retained; owners can remove non-required memberships |
| `auth_sessions` | Hashed session subject, workspace and revocation evidence | Account/workspace scoped | Automatic: expired sessions removed 7 days after expiry |
| `auth_rate_limits` | Hashed login key, failure count and lockout | Global security control | Automatic: inactive unlocked records after 30 days |
| `contributors` | Public GitHub profile/contact fields plus private recruiter notes and reminders | Workspace-owned; contributors are not shared across workspaces | Retained; no direct contributor-deletion action |
| `scrapes` | Repository target, progress, aggregate results and sanitized failure state | Workspace-owned | Retained; operator may delete an individual scrape |
| `scrape_contributors` | Contributor membership and contribution count for a scrape | Workspace-owned relationship | Cascade with scrape or contributor |
| `shared_scrapes` | Hashed bearer link, expiry, revocation and access counters | Workspace-owned | Automatic: 30 days after expiry or revocation; individual links can be revoked |
| `ecosystems` | Recruiter-created Project identity | Workspace-owned | Retained; operator may delete a Project |
| `ecosystem_scrapes` | Project-to-scrape membership | Workspace-owned relationship | Cascade with Project or scrape; operator can unlink |
| `project_contributors_cache` | Derived contributor overlap and source scrape identifiers | Workspace-owned derived data | Recomputed; cascade with Project |
| `project_lists` | Recruiter-created shortlist names | Workspace-owned | Cascade with Project; operator may delete a list |
| `project_list_contributors` | Saved shortlist membership | Workspace-owned relationship | Cascade with list or contributor |
| `project_contributor_tracking` | Private recruiting status, notes and follow-up dates | Workspace-owned | Cascade with Project or contributor |
| `watched_repos` | Repository watch configuration and latest check outcome | Workspace-owned | Retained; operator may delete a watch |
| `watched_repo_contributors` | Public GitHub usernames detected by a watch | Workspace-owned relationship | Cascade with watched repository |
| `scrape_jobs` | Durable worker state, leases, retries and sanitized terminal error | Workspace-owned operational data | Automatic: terminal jobs after 90 days; active jobs never expire |
| `scrape_job_contributions` | Temporary contributor discovery candidates | Workspace-owned staging data | Cascade with scrape job |
| `scrape_job_repository_contributions` | Temporary organization repository contribution staging | Workspace-owned staging data | Cascade with scrape job |
| `scrape_job_events` | Append-only execution history and safe diagnostic metadata | Workspace-owned operational data | Cascade when terminal job reaches 90 days; direct application deletion denied |
| `scrape_enqueue_requests` | Idempotency key and request-to-job relationship | Workspace-owned operational data | Cascade with scrape job |
| `service_cooldowns` | GitHub cooldown time, reason and optional source job | Global operational control | Retained as bounded single-row operational history |
| `notification_deliveries` | Secret-free Slack outbox payload, lease, attempts and sanitized error | Workspace-owned operational data | Automatic: terminal deliveries after 90 days |
| `storage_cleanup_tasks` | Deleted-workspace profile-photo paths and bounded retry state | Global operational cleanup | Paths retained only while work can retry; successful rows retain path-free evidence and are never browser-readable |
| `activity_events` | Recruiter-visible product activity metadata | Workspace-owned | Automatic after 180 days |
| `audit_events` | Append-only security actions, outcome, hashed IP and safe metadata | Workspace when available; some authentication events are global | Automatic after 180 days; direct application deletion denied |
| `system_runs` | Scheduler and worker health outcomes with aggregate details | Global operational history | Automatic after 30 days |
| `talon_schema_migrations` | Applied schema version ledger | Global database contract | Permanent |

## Boundaries outside Postgres

- Supabase Auth identities are not in Talon's logical database backup and need a
  separate account-deletion decision.
- Supabase Storage profile photos are outside the Postgres table inventory and
  need object cleanup when an account or workspace is eventually deleted.
- Vault secrets, Supabase Cron jobs, Vercel environment variables, Slack
  configuration, and GitHub credentials are configuration, not workspace data.
- Encrypted backup archives can retain rows after the live database deletes
  them. Backup location, access, expiry, and destruction must be recorded in the
  recovery process; Talon cannot erase an offline copy it does not control.
- CSV exports and data copied from a public share leave Talon's control. The
  product can revoke future access but cannot recall an already downloaded copy.

## Workspace export and deletion

Owners can request `GET /api/workspace-lifecycle/preview` to receive current,
count-only Postgres scope and active-work blockers. The response excludes row
content and workspace identifiers, is never cached, and marks Auth, Storage,
backups, and downloaded exports as outside the database count. This is a safety
diagnostic, not confirmation that deletion is safe or available.

Owners can request `POST /api/workspace-lifecycle/export` to download a
versioned JSON copy of recruiter-owned workspace data. The export includes
members, contributors and private recruiting fields, scrape results, Projects,
lists, tracking, non-secret share metadata, and watched-repository state. It
excludes Auth and Storage data, sessions, operational histories, derived caches,
backups, and secrets. Immediate downloads are capped at 4 MiB; larger workspaces
fail safely rather than returning a partial file. The downloaded file contains
private contact information and recruiter notes, leaves Talon's access controls,
and must be stored and shared accordingly.

Verify a downloaded file without printing its private contents:

```bash
pnpm export:verify -- /absolute/path/to/talon-workspace-export-YYYY-MM-DD.json
```

The verifier checks the versioned field contract, size bound, duplicate entity
identifiers, and references between contributors, scrapes, Projects, lists,
tracking records, share metadata, and watched repositories. It reports only the
format version, generation time, and total row count.

Owners can use the Workspace Data card in Settings to refresh the preview,
download an export, and permanently delete a workspace. The destructive action
is available only to a signed-in owner, requires the exact workspace slug, and
is refused while scrapes or notification deliveries are active. The database
locks the workspace root and deletes all Postgres-owned workspace data in one
transaction, so an old worker lease cannot recreate data after the team row is
removed. Workspace-linked audit history is removed and replaced by one global,
non-identifying deletion receipt.

Profile-photo paths are captured into a private cleanup task by the deletion
transaction and removed from Supabase Storage immediately afterward. If that
external cleanup fails, the database deletion remains committed and the
one-minute worker retries with bounded backoff and stale-lease recovery.
Supabase Auth identities are intentionally retained because one identity may be
used by another workspace; deleted members can no longer resolve live workspace
membership for the deleted workspace.

The deletion boundary has these deliberate limitations:

1. Live deletion does not immediately remove older encrypted backups.
2. Talon cannot recall exports, CSV files, or public-share data already copied
   by another person.
3. A terminal Storage cleanup failure remains visible in Production Readiness
   without returning an object path to the browser.
