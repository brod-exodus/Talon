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
| `teams` | Workspace identity and private-owner email | Root workspace record | Retained; Talon has no workspace-deletion action |
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

## Required design before workspace deletion

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

A future deletion feature must not start as a collection of browser-side delete
requests. It requires one owner-only, database-transactional operation with:

1. The existing read-only preview plus explicit Auth identity and Storage object
   lookup during the destructive operation.
2. Explicit handling for queued/running work and notification deliveries so an
   old lease cannot recreate or mutate data during deletion.
3. Revocation of shares and sessions before destructive work begins.
4. A decision on the final audit record: preserving a non-identifying deletion
   receipt or deleting workspace-linked audit rows after recording external
   operator evidence.
5. Idempotent retry and an observable terminal result for partial failures
   outside Postgres, especially Auth and Storage.
6. Documentation that live deletion does not immediately remove older encrypted
   backups or copies previously exported by users.

This inventory does not authorize workspace deletion, introduce new retention
windows, or change current product behavior. Those decisions require a separate
reviewable migration and explicit operator acceptance criteria.
