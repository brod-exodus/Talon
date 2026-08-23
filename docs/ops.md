# Talon Ops Runbook

## Production Smoke Check

Run the automated release smoke after deployment:

```bash
BASE_URL="https://your-domain.example" \
ADMIN_EMAIL="owner@example.com" \
ADMIN_PASSWORD="..." \
SMOKE_REPO="octocat/Hello-World" \
pnpm smoke:production
```

It verifies:

1. Login and admin health access.
2. Supabase, GitHub credentials, recent keepalive, and recent worker activity.
3. Direct keepalive authentication when `CRON_SECRET` is provided.
4. Queue creation, cancellation stability, and retry.
5. Queued work completing through the durable worker.
6. Contributor pagination and CSV generation using Talon's production exporter.
7. Public read-only share creation and access without an authenticated cookie.
8. Cleanup of both smoke scrapes and the cascading share token.

The script exits non-zero on the first failed acceptance check. By default it
deletes its artifacts even when a later check fails. Set
`KEEP_SMOKE_ARTIFACTS=true` only for deliberate debugging.

Starting and retrying a scrape are queue-only commands. Each returns HTTP `202`
after the durable state change and schedules a best-effort immediate worker
after the response. The Supabase one-minute worker schedule remains the recovery
path if that dispatch is interrupted. A Retry request should therefore return
promptly even when the scrape itself needs many worker steps. The production
smoke fails if Retry does not return HTTP `202` within ten seconds; override
`RETRY_MAX_SECONDS` only when diagnosing unusual network latency.

Each worker invocation drains as many as five completed jobs, but every job
shares the invocation's forty-second time budget and twenty-step GitHub budget.
The worker reserves ten seconds of headroom before claiming another job and
stops after a job yields or errors, ensuring later work is never claimed without
enough time to persist a safe outcome. The worker response, structured log, and
`system_runs.details` record `elapsedMs` and `stopReason`; expected reasons are
`queue_empty`, `job_limit`, `time_budget`, `step_budget`, `job_yielded`, and
`job_error`.

## Post-Deploy Smoke Checklist

Run this after every production deploy:

1. Run `pnpm smoke:production` and save the pass/fail result in the PR or release notes.
2. Open Settings and verify Recent Security Events includes the smoke actions.
3. Download one CSV from the UI and open it to confirm the browser download path.
4. Run Watched Repos `Check Now` and confirm `last checked` updates.
5. Verify Vercel deploy checks are green and no unresolved preview comments remain.

## Database Migrations

Apply migrations in order from `db/migrations`.

Before opening a release PR, validate the repository contract:

```bash
pnpm migrations:check
```

This rejects missing or duplicate migration numbers, an application/version
mismatch, and new migrations that do not record themselves in
`talon_schema_migrations`.

Pull-request CI also starts a fresh local Supabase database and executes every
canonical migration in order. This catches SQL syntax errors, missing database
objects, and ordering mistakes before a migration reaches the Production SQL
Editor. The temporary Supabase migration files are generated from
`db/migrations`; do not maintain a second committed copy. The CI database uses
the pinned Supabase CLI and local image and needs no Production credential.

### Atomic scrape enqueue

Migration `028_idempotent_scrape_enqueue.sql` makes the start-scrape command a
single database transaction. The scrape, queue job, optional project link, and
initial job event either all exist or none do. Each request carries a UUID
`Idempotency-Key`; retrying the same payload with the same key returns the
original scrape and job, while reusing a key for different input returns HTTP
`409`.

Apply migration 028 before deploying the compatible application. After deploy,
run `pnpm smoke:production`; its completion scrape is submitted twice with one
key and must return the same `scrapeId` and `jobId`. No new environment variable
is required.

Rollback the application normally if needed. Migration 028 is additive and can
remain installed; do not drop its request records during an application
rollback. The schema health check will report that the database is ahead until
the compatible application is redeployed.

### Operation correlation

Migration `029_operation_correlation.sql` adds a nullable UUID `request_id` to
audit events, system runs, scrape jobs, scrape job events, and idempotent enqueue
records. Apply it before deploying the compatible application. No environment
variable is required.

Authenticated Talon pages and API responses include an `X-Request-ID` header.
The same ID is passed into the application request and persisted at critical
operational boundaries. Scrape jobs retain the ID of the request that originally
created them; each scheduled worker invocation receives its own ID. Worker run
details record both so an operator can connect the original command to later
cron work.

Given an ID from a browser response or sanitized JSON log, investigate it in the
Supabase SQL Editor:

```sql
select id, action, outcome, created_at
from public.audit_events
where request_id = '00000000-0000-4000-8000-000000000000';

select id, kind, status, started_at, completed_at, details, error
from public.system_runs
where request_id = '00000000-0000-4000-8000-000000000000';

select id, scrape_id, status, attempts, request_id, updated_at
from public.scrape_jobs
where request_id = '00000000-0000-4000-8000-000000000000';

select job_id, scrape_id, event_type, request_id, created_at
from public.scrape_job_events
where request_id = '00000000-0000-4000-8000-000000000000'
order by created_at;
```

Critical scrape, worker, keepalive, watched-repository, audit, and GitHub-client
logs are emitted as one-line JSON. They redact credential-like keys, URLs, email
addresses, repository targets, contributor identifiers, and long values. Never
add raw request bodies, GitHub response bodies, contact fields, or secret values
to log context.

Migration 029 is additive and may remain installed during an application
rollback. The prior enqueue RPC remains compatible because the new request ID
argument is optional. A rolled-back application will report the database as
ahead until the compatible release is restored.

### Lease-safe worker transitions

Migration `030_lease_safe_job_transitions.sql` moves worker yield, failure,
completion, cancellation, manual retry, and stale-lock recovery into database
transactions. Each worker transition locks the job row and checks that it is
still `running`, still belongs to the calling worker, and has not been canceled.
Control and terminal transitions update the job and parent scrape together.
This prevents an interrupted or stale worker from reviving a canceled job,
overwriting a newer worker's state, or leaving the job and scrape inconsistent.

Apply migration 030 before deploying the compatible application. No environment
variable or scheduler change is required. After deployment, run
`pnpm smoke:production`; its cancel/retry flow confirms that canceled state
remains stable before retrying.

Migration 030 is additive and may remain installed during an application
rollback. The prior application does not call its new functions, so rolling back
only requires redeploying the previous application version.

### Atomic concurrent job claims

Migration `031_atomic_job_claim.sql` replaces the worker's read-then-update
claim loop with one database transaction. The claim selects the oldest due job
using `FOR UPDATE SKIP LOCKED`, marks it running, increments its attempt count,
and records the claim event before returning it to the worker. Concurrent worker
invocations therefore claim different jobs instead of contending for the same
five candidates or incorrectly reporting an empty queue.

Apply migration 031 before deploying the compatible application. No environment
variable or scheduler change is required. The migration is additive and may
remain installed during an application rollback.

### Lease-safe worker checkpoints

Migration `032_lease_safe_job_checkpoints.sql` moves worker cursor and progress
updates into one database transaction. The checkpoint locks the job and verifies
that it is still running, still belongs to the calling worker, and has not been
canceled before updating either the job state or its parent scrape. An expired
worker can therefore no longer overwrite progress or resumable state after a
new worker has recovered the job.

Apply migration 032 before deploying the compatible application. No environment
variable or scheduler change is required. After deployment, the normal
cancel/retry portion of `pnpm smoke:production` verifies the surrounding worker
control flow. The migration is additive and may remain installed during an
application rollback.

### Resumable repository contributor discovery

Repository scrapes fetch and persist one GitHub contributor page per worker
step. Each successful page saves the next-page cursor through the lease-safe
checkpoint before another page is requested. Replaying a page is idempotent
because repository contribution totals are upserted by job and GitHub login.

Worker GitHub requests use a ten-second attempt timeout and do not perform
in-process retries. Transient failures return the job to Talon's existing
durable retry schedule, leaving enough time for the worker to persist a clean
outcome before the serverless invocation limit. Watched-repository checks keep
the full-list helper because they are not durable scrape jobs.

This change has no database migration, environment variable, or scheduler
change. Deploy the application normally and run `pnpm smoke:production`.
Rollback only requires redeploying the previous application version.

### Resumable organization repository discovery

Organization scrapes enumerate one GitHub repository page per worker step and
persist the next page plus the deduplicated eligible repository list. Forked and
archived repositories remain excluded. Pages use a deterministic repository-name
sort to reduce cursor drift while a long enumeration is running. Only after
GitHub reports the final page does Talon begin scanning contributor totals for
the discovered repositories.

Jobs started by the prior release remain compatible: a populated repository
list without the new page fields is treated as already enumerated. This change
has no database migration, environment variable, or scheduler change. Deploy
normally, run `pnpm smoke:production`, and rollback by redeploying the previous
application version if necessary.

### Replay-safe organization contributor discovery

Migration `033_replay_safe_organization_contributors.sql` adds repository-level
staging for organization contributor pages and an atomic checkpoint function.
Each worker step fetches at most one GitHub contributor page. The transaction
validates the active worker lease and expected repository/page cursor, stages
that page, and advances the cursor together. Only the final page for a repository
adds its staged totals to the job-wide aggregate, then removes the repository
staging rows. A replay therefore replaces staged page values instead of counting
them twice, and a lost response cannot repeat an already-committed repository.

Apply migration 033 before deploying the compatible application. It requires no
environment variable or scheduler change. After deployment, run
`pnpm smoke:production` and exercise an organization with a repository containing
more than 100 contributors; its event history should show consecutive
`organization_contributor_page_scanned` entries before hydration begins.

Migration 033 is additive and may remain installed during an application
rollback. The previous application ignores repository staging and continues to
write only the job-wide aggregate. Partial staging rows are never visible to it
and are deleted automatically with the parent job.

### Lease-safe contributor hydration

Migration `034_lease_safe_hydration.sql` moves each hydrated profile batch into
one database checkpoint. After GitHub profile requests finish, the transaction
locks the queue job and verifies its active worker, cancellation state, hydration
phase, and exact job contribution candidates. It then upserts public profile
fields, links contributors to the scrape, calculates progress from the links
that actually exist, and records the persistence event together. Progress is no
longer advanced before the network work succeeds, and a canceled or recovered
worker cannot write a late batch.

Apply migration 034 before deploying the compatible application. It requires no
environment variable or scheduler change. After deployment, run
`pnpm smoke:production`; its cancel/retry path and completion scrape exercise the
surrounding hydration control flow. For a focused check, cancel a scrape during
profile hydration and confirm its contributor count stops changing after the
canceled state is visible.

Migration 034 is additive and may remain installed during an application
rollback. The previous application does not call the new checkpoint function,
so rollback requires only redeploying the prior application version.

### Verified atomic scrape completion

Migration `035_verified_scrape_completion.sql` makes Postgres authoritative for
the final success decision. The completion transaction locks and validates the
worker lease, counts eligible candidates from job staging, and requires an exact
set of scrape links with matching contribution totals. It derives contributor
and contact counts from those links, then commits the scrape, job, job event, and
product activity notification together. The application no longer supplies
completion counts from separate, race-prone reads.

Project contributor caches remain derived data. Talon refreshes affected caches
after the successful transaction and records a sanitized error if refresh fails;
that recoverable side effect can no longer make an already-completed job appear
to fail. Normal project reads retain their existing stale-cache repair path.

Apply migration 035 before deploying the compatible application. It requires no
environment variable or scheduler change. After deployment, run
`pnpm smoke:production` and confirm its completion scrape reports matching
`contributorTotal`, progress 100, and a single `scrape.completed` activity.

Migration 035 is additive and retains the previous completion function for
rollback. Redeploying the prior application version is sufficient; no database
rollback is required.

### Contributor profile freshness cache

Migration `036_contributor_profile_freshness_cache.sql` records GitHub-profile
freshness separately from a contributor's general `updated_at` value. A
successful profile fetch refreshes that timestamp; recruiter workflow edits do
not. During hydration, Talon atomically links matching team profiles fetched in
the last seven days and sends GitHub requests only for stale or missing users.
Existing contributors begin with no freshness timestamp and are refreshed once
before they become reusable.

Apply migration 036 before deploying the compatible application. It requires no
environment variable or scheduler change. After deployment, run the same small
repository scrape twice. The second scrape's `hydrate_started` events should
report cached profiles, and its `cached_contributors_linked` events should
replace most or all GitHub profile requests.

The migration is additive and may remain installed during an application
rollback. Redeploying the previous application version ignores the cache column
and function; profile refreshes continue to update the timestamp through the
database trigger.

Security hardening migrations include:

```text
db/migrations/007_security_events.sql
db/migrations/010_service_role_rls_lockdown.sql
db/migrations/024_system_runs.sql
db/migrations/025_contactable_scrape_contributors_rpc.sql
db/migrations/026_share_lifecycle_and_retention.sql
db/migrations/027_schema_version_contract.sql
db/migrations/028_idempotent_scrape_enqueue.sql
db/migrations/029_operation_correlation.sql
db/migrations/030_lease_safe_job_transitions.sql
db/migrations/031_atomic_job_claim.sql
db/migrations/032_lease_safe_job_checkpoints.sql
db/migrations/033_replay_safe_organization_contributors.sql
db/migrations/034_lease_safe_hydration.sql
db/migrations/035_verified_scrape_completion.sql
db/migrations/036_contributor_profile_freshness_cache.sql
db/migrations/037_github_rate_limit_cooldown.sql
db/migrations/038_durable_watched_repo_checks.sql
db/migrations/039_notification_delivery_outbox.sql
db/migrations/040_atomic_team_member_management.sql
db/migrations/041_contactable_contributor_locations.sql
db/migrations/042_workspace_referential_integrity.sql
db/migrations/043_schema_contract_attestation.sql
db/migrations/044_append_only_operational_history.sql
db/migrations/045_revocable_sessions.sql
db/migrations/046_bounded_active_sessions.sql
```

They create or enforce:

- `audit_events`: recent admin, cron, scrape, share, watched-repo, and outreach events.
- `auth_rate_limits`: persistent failed-login counters and temporary lockouts.
- `service_cooldowns`: private shared backpressure state for GitHub wait responses.
- Service-role-only app access for private tables, plus future authenticated team-member read policies.

If Settings cannot load recent security events, confirm migration `007` has been applied. If scrapes fail after removing temporary Supabase policies, confirm `SUPABASE_SERVICE_ROLE_KEY` is configured and migration `010` has been applied.

Apply migration `026` before deploying the matching application release. It is
expand-first: the prior release can continue creating and opening shares during
the rollout, while the new release resolves only token hashes. After deployment,
expired legacy raw-token IDs are replaced with opaque UUIDs by keepalive cleanup;
active legacy links retain rollback compatibility until their expiration.

## Share lifecycle and data retention

Share links default to seven days and can be configured for 1, 7, or 30 days.
Operators can review link history, view approximate access counts, and revoke an
active link from the scrape card. Revoked and expired links return HTTP `410`.
Only public GitHub profile/contact fields appear in a shared response; recruiter
notes, outreach status, reminders, internal errors, and team identifiers do not.
The CSV switch controls Talon's built-in download button, but it cannot prevent a
viewer from copying data that is already visible in their browser.

The daily `/api/keepalive` call runs `cleanup_talon_retention()` and records its
row counts in `system_runs.details`. Current retention windows are:

| Data | Retention |
| --- | --- |
| Expired or revoked share metadata | 30 days after expiry/revocation |
| Keepalive and worker run history | 30 days |
| Audit and activity events | 180 days |
| Inactive authentication rate-limit records | 30 days |
| Expired authentication sessions | 7 days after expiry |
| Terminal scrape jobs and their staging/events | 90 days |
| Completed scrape results and contributors | Kept until an operator deletes them |

To verify the cleanup manually in Supabase SQL Editor without deleting anything,
inspect the eligible counts first:

```sql
select
  (select count(*) from shared_scrapes
    where expires_at < now() - interval '30 days'
       or (revoked_at is not null and revoked_at < now() - interval '30 days')) as old_shares,
  (select count(*) from system_runs
    where started_at < now() - interval '30 days') as old_system_runs,
  (select count(*) from scrape_jobs
    where status in ('succeeded', 'failed', 'canceled')
      and updated_at < now() - interval '90 days') as old_terminal_jobs;
```

Use `select cleanup_talon_retention();` only when you intentionally want to run
the cleanup immediately. The function is restricted to the database owner and
Talon's service role.

## Database schema deployments

Apply migration `027` before deploying the application release that introduces
schema health checks. First confirm migrations `001` through `026` have been
applied; migration `027` then records that historical baseline and exposes the
current version only to Talon's service role.

Use this read-only preflight before adopting the v27 ledger. It must return no
rows:

```sql
WITH prerequisites(required_object, is_present) AS (
  VALUES
    ('table public.scrapes', to_regclass('public.scrapes') IS NOT NULL),
    ('table public.contributors', to_regclass('public.contributors') IS NOT NULL),
    ('table public.scrape_jobs', to_regclass('public.scrape_jobs') IS NOT NULL),
    ('table public.scrape_job_contributions', to_regclass('public.scrape_job_contributions') IS NOT NULL),
    ('table public.scrape_job_events', to_regclass('public.scrape_job_events') IS NOT NULL),
    ('table public.shared_scrapes', to_regclass('public.shared_scrapes') IS NOT NULL),
    ('table public.teams', to_regclass('public.teams') IS NOT NULL),
    ('table public.team_memberships', to_regclass('public.team_memberships') IS NOT NULL),
    ('table public.audit_events', to_regclass('public.audit_events') IS NOT NULL),
    ('table public.auth_rate_limits', to_regclass('public.auth_rate_limits') IS NOT NULL),
    ('table public.activity_events', to_regclass('public.activity_events') IS NOT NULL),
    ('table public.project_contributors_cache', to_regclass('public.project_contributors_cache') IS NOT NULL),
    ('table public.project_lists', to_regclass('public.project_lists') IS NOT NULL),
    ('table public.project_contributor_tracking', to_regclass('public.project_contributor_tracking') IS NOT NULL),
    ('table public.system_runs', to_regclass('public.system_runs') IS NOT NULL),
    ('function public.talon_current_user_team_ids()', to_regprocedure('public.talon_current_user_team_ids()') IS NOT NULL),
    ('function public.get_contactable_scrape_contributors_page(text,integer,integer)', to_regprocedure('public.get_contactable_scrape_contributors_page(text,integer,integer)') IS NOT NULL),
    ('function public.cleanup_talon_retention()', to_regprocedure('public.cleanup_talon_retention()') IS NOT NULL)
)
SELECT required_object AS missing_object
FROM prerequisites
WHERE NOT is_present
ORDER BY required_object;
```

For every future database change:

1. Create the next contiguous `NNN_snake_case.sql` file.
2. Make the migration safe to apply before its compatible application deploy.
3. Insert its own version and name into `talon_schema_migrations`.
4. Increase `EXPECTED_SCHEMA_VERSION` in `lib/schema-version.ts`.
5. Run `pnpm migrations:check`, apply the migration, then deploy the application.
6. Open **Settings → Production Readiness** and verify **Database Schema** says
   the current and expected versions match.

If the database is behind, `/api/health` returns HTTP `503`. If the database is
ahead after an application rollback, health reports a warning so the operator
can verify backward compatibility. Additive migrations should normally remain
in place during an application rollback; do not reverse a migration by deleting
production data or columns unless its documented rollback explicitly requires it.

## Auth Lockouts

Admin login allows 5 failed attempts per hashed client IP in a 15 minute window. After that, login is locked for 15 minutes and `/api/auth/login` returns `429`.

Successful login clears the rate-limit record for that client.

## Registration policy

Self-service registration is closed by default. With
`TALON_SELF_SERVICE_SIGNUP_ENABLED` absent or set to anything except `true`, the
login page shows sign-in only and `POST /api/auth/signup` returns `403` before
calling Supabase Auth. Existing accounts and administrator-created teammates are
not affected.

Use **Settings → Team Access** to provision a teammate. Only set
`TALON_SELF_SERVICE_SIGNUP_ENABLED=true` in Vercel when intentionally launching
self-service workspaces, and redeploy after changing it. Before enabling it,
verify auth email delivery, abuse controls, GitHub API capacity, and the account
support path. To roll back, remove the variable or set it to `false` and
redeploy; no database rollback is required.

## Team ownership safety

Migration `040_atomic_team_member_management.sql` moves role changes and member
removals into service-role-only database functions. Both functions lock the
parent team before counting owners, so concurrent requests cannot each remove a
different owner and leave the team ownerless. The API returns `409` when an
operation would demote or remove the final application owner.

Only the `owner` application role has the `manage_members` permission. Operational
admins retain settings, health, audit, scrape, and watched-repository access but
cannot list or change teammate accounts. The break-glass admin login retains full
recovery access.

Before changing an owner, promote another member to owner first. If access is
misconfigured, use the break-glass admin login and **Settings → Team Access** to
repair roles. Roll back the application if needed, but leave the additive
migration in place; the previous direct-update route remains compatible with the
unchanged table schema.

## Browser security boundary

Talon rejects cross-site state-changing browser requests before team
authorization runs. Same-origin requests continue normally, while originless
writes fail closed. The production smoke workflow supplies its expected origin;
cron routes continue to authenticate through `CRON_SECRET`. Public login,
conditionally enabled signup, and logout routes apply the same check.

Every application route also receives a Content Security Policy, clickjacking
protection, MIME-sniffing protection, a restrictive referrer policy, and browser
feature restrictions. After deployment, inspect any page response in browser
developer tools and confirm these headers are present. If a new external font,
image, script, or browser API is intentionally introduced, update the policy to
the narrowest required origin rather than adding a wildcard.

## Dependency security

Run `pnpm security:audit` before every release. CI blocks known high- and
critical-severity advisories, while the separate Security workflow runs CodeQL
and reviews dependency changes. See `docs/dependency-security.md` for the update,
override, and incident-response policy.

## Security Events

Recent events are visible in Settings under `Recent Security Events`.

Events intentionally avoid storing secrets such as GitHub tokens, Slack webhook URLs, outreach notes, or share tokens. IP addresses are stored as salted hashes.

Useful actions to check during incident response:

- `auth.login`
- `scrape.start`
- `scrape.retry`
- `scrape.cancel`
- `scrape.delete`
- `scrape_worker.run`
- `watched_repo.check`
- `watched_repo.create`
- `watched_repo.delete`
- `share.create`
- `share.revoke`
- `outreach.update`

## Scrape Recovery

### Shared GitHub API cooldown

Migration `037_github_rate_limit_cooldown.sql` adds private operational state
for GitHub wait responses. When a worker receives a primary or secondary rate
limit, or an explicit `Retry-After`, its lease-safe failure transaction records
the retry and activates one cooldown for the shared server token. Atomic job
claims return no work until that timestamp has passed, so queued jobs do not
burn their own attempts against the same exhausted credential.

Apply migration 037 before deploying the compatible application. It requires
no environment-variable or scheduler changes. During a cooldown, **Settings →
Production Readiness** reports when automatic processing resumes, queue depth
remains visible, and credential checks avoid making another GitHub request.
Starting a new scrape returns HTTP `429` with the same automatic-resume time;
existing queued jobs remain durable.

To inspect the private state without exposing credentials:

```sql
select service, blocked_until, reason, source_job_id, updated_at
from public.service_cooldowns
where service = 'github';
```

An expired row is normal operational history and does not block work. Do not
delete or shorten an active cooldown to force requests through GitHub's limit.
After `blocked_until`, run the scheduled worker or wait for the next one-minute
invocation and confirm the queue begins draining without a manual retry.

Rollback by redeploying the previous application. Migration 037 is additive
and may remain; the prior claim function does not consult the cooldown table.

### Durable watched-repository checks

Migration `038_durable_watched_repo_checks.sql` moves repository monitoring onto
the existing bounded scrape queue. It adds persistent queued, running,
succeeded, and failed status to `watched_repos`, associates internal scrapes
with their watch, and records which scrape first detected each contributor.
Completion atomically establishes the initial baseline or records only newly
detected contributors. Migration 039 below makes the separate Slack-delivery
outcome durable.

Apply migration 038 before deploying the compatible application. It requires
no new environment variables and no new cron job: the existing one-minute
`/api/scrape-jobs/run` schedule enqueues due watches before processing queued
work. After deployment, use **Watched Repos → Check Now** and confirm the card
moves from Queued to Checking to Monitoring. Internal watch scrapes do not
appear in ordinary scrape lists or repository scrape SLO calculations.

To inspect the durable state:

```sql
select repo, interval_hours, check_status, last_check_started_at,
       last_check_completed_at, last_check_error,
       last_new_contributors, last_baselined_contributors,
       last_notification_status
from public.watched_repos
order by created_at desc;
```

Rollback by redeploying the previous application. Migration 038 is additive;
the previous synchronous route ignores its new columns. Internal `watch-*`
scrapes already queued by the new release may be allowed to finish or removed
through the normal retention process.

### Durable notification delivery

Migration `039_notification_delivery_outbox.sql` adds a private, secret-free
outbox for watched-repository Slack alerts. The activity event and its
deduplicated delivery record commit in the same database transaction. The
existing one-minute worker claims at most a small bounded batch before scrape
work, retries temporary failures with exponential backoff, recovers delivery
leases older than ten minutes, and marks a delivery terminally failed after five
attempts. No webhook URL, token, contributor profile, or message body is stored
in the outbox.

Apply migration 039 before deploying the compatible application. It requires
no new environment variables and no scheduler change. **Settings → Production
Readiness** shows queue depth, due age, stale sending leases, and terminal
delivery failures. The daily keepalive removes terminal delivery records after
90 days.

Inspect delivery state without exposing the configured webhook:

```sql
select id, kind, status, attempts, max_attempts, run_after,
       locked_at, last_error, created_at, completed_at
from public.notification_deliveries
order by created_at desc
limit 50;
```

After correcting a Slack configuration or outage, requeue terminal failures in
Supabase SQL Editor and wait for the next one-minute worker invocation:

```sql
select public.retry_failed_notification_deliveries();
```

Slack incoming webhooks do not accept an idempotency key. Talon therefore
provides at-least-once delivery: an interruption after Slack accepts a request
but before the success transition can rarely produce a duplicate, while the
transactional outbox prevents silent loss. Roll back by redeploying the previous
application. Migration 039 is additive and may remain, but pending deliveries
will pause until the compatible worker is deployed again.

### Repository scrape SLOs

Settings → Production Readiness calculates two rolling seven-day indicators
from terminal repository scrapes:

- **Reliability:** at least 95% of completed-or-failed repository scrapes should
  complete successfully.
- **Latency:** the 95th-percentile end-to-end completion time should be no more
  than three minutes.

Canceled scrapes are excluded because they reflect an operator decision rather
than service reliability. Organization scrapes are excluded because repository
count makes their runtime fundamentally different. Talon waits for at least five
observations before evaluating either target; smaller samples remain visible as
limited evidence. A missed historical SLO produces **Attention**, not HTTP `503`,
because it should prompt investigation without claiming the live service is
unavailable.

The daily keepalive also persists an aggregate SLO snapshot in
`system_runs.details.sloMonitor`. When `SLACK_WEBHOOK_URL` is configured, Talon
sends one notification for each new breach fingerprint and one notification
after a notified breach recovers. Repeated healthy checks and an unchanged
breach do not generate messages. Notification failures do not make the
keepalive fail; the stored `notification` status remains `failed` so the same
breach is retried on the next daily run. Messages contain only aggregate counts
and timing metrics—never repository names, contributor data, or secrets.

After deployment, call `/api/keepalive` with `CRON_SECRET` or wait for the daily
schedule, then inspect the latest successful `keepalive` row in `system_runs`.
Its `details.sloMonitor` object reports the evaluated state, fingerprint, sample
size, metrics, and notification outcome. No database migration is required for
this feature because the state uses the existing JSON `details` column.

When an SLO is missed:

1. Compare p50 and p95. A high p95 with a healthy p50 usually indicates outliers;
   both being high indicates a systemic slowdown.
2. Inspect failed jobs and recent job events before retrying anything.
3. Check GitHub rate-limit capacity, shared cooldown, queue age, and worker
   freshness in the same panel.
4. Record the affected time window, targets, and representative scrape IDs in
   the incident or PR notes.
5. After a fix deploys, confirm new scrapes improve the rolling window; do not
   delete failed history merely to make the indicator green.

If a scrape is stuck:

1. Open Settings Health and inspect queue depth, oldest queued age, stale locks, and the last successful worker run.
2. Confirm the `talon-scrape-worker` Supabase Cron job is active and has recent successful executions.
3. Check the active scrape card for the job status and latest error.
4. Use Retry if the scrape is failed or retry scheduled.
5. Use Cancel if the scrape is running too long or has clearly bad input.
6. Check Settings security events for `scrape_worker.run` and `scrape.retry`.
7. Check Vercel function logs for `/api/scrape`, `/api/scrape-jobs/run`, and `/api/scrape-jobs/[id]/retry`.

### Completed-list location search

Apply migration 041 before deploying the compatible application. It adds the
self-reported GitHub location to the existing lightweight, contactable-only
contributor response; it does not restore biography or company fields and does
not change the worker schedule or environment variables. The migration is safe
to apply before deployment because older application versions ignore the added
response field.

After deployment, open a completed scrape and search the Location field. Verify
that a stored `New York, NY` location matches both `NYC` and `New York`, while an
unrelated or blank location does not. Talon does not infer a location when the
GitHub profile omits one. Roll back by redeploying the previous application;
migration 041 may remain installed.

### Workspace referential integrity

Apply migration 042 before deploying the compatible application. It validates
existing workspace-owned relationships, backfills `team_id` on
`scrape_contributors`, and adds composite foreign keys tying child records to
parents in the same workspace. No environment variable or scheduler change is
required. Older application versions remain compatible because the database
derives `scrape_contributors.team_id` when an older insert omits it.

If the migration reports `Workspace referential-integrity violation found in
...`, stop and inspect that named relationship rather than deleting records or
disabling the check. The failure indicates pre-existing cross-workspace data
that must be assigned to the correct workspace before retrying the migration.
If it reports a missing table, apply the named historical migration first. The
schema ledger created by migration 027 records the intended historical baseline
and cannot prove that every earlier SQL file was successfully applied.

After deployment, confirm Settings reports database schema v42 and run the
normal production scrape smoke. Also open a Project, a completed scrape, a
saved contributor list, and Watched Repos to verify their existing relationships
still load. Roll back the application by redeploying the previous build;
migration 042 is backward-compatible and should remain installed.

### Physical schema contract attestation

Apply migration 043 before deploying the compatible application. The migration
adds a service-role-only catalog check for Talon's critical tables, columns,
functions, validated workspace constraints, and row-level-security settings.
The Production Readiness database check now fails when one of those objects is
missing even if `talon_schema_migrations` reports the expected version. This
closes the historical-ledger gap documented above.

No environment variable or scheduler change is required. After deployment,
confirm Settings reports database schema v43 and does not list missing schema
requirements. If attestation fails, restore the named object by applying its
canonical migration; do not insert or edit schema-ledger rows to hide the
failure. Roll back the application by redeploying the previous build. Migration
043 is read-only at runtime and may remain installed.

### Fail-closed service-role workspace scope

Application database helpers reject missing or blank workspace identifiers
instead of silently using the default workspace. This does not require a
database migration, environment change, or scheduler change. Break-glass admin
requests remain compatible because `resolveTeamContext` explicitly resolves the
default workspace before calling the data layer.

After deployment, run the normal production smoke as both the break-glass admin
and one provisioned user if available. Confirm each sees only their intended
workspace. Roll back by redeploying the previous application build; there is no
database rollback.

### Audit actor attribution

Audit writes derive the actor from the signed request session. Team-user events
include a salted, one-way email identifier in metadata; break-glass admin,
scheduler, and unauthenticated authentication attempts use distinct actor
labels. The Settings security ledger and CSV export expose this attribution.

No database migration, environment variable, or scheduler change is required.
After deployment, run one manual watched-repository check as a team user and
confirm its audit event identifies a team user rather than the break-glass
admin. Roll back by redeploying the previous application build.

### Append-only operational history

Migration `044_append_only_operational_history.sql` removes direct update,
delete, and truncate privileges on `audit_events` and `scrape_job_events` from
application roles. The service role retains select and insert access. The
database-owned `cleanup_talon_retention()` function keeps its controlled
180-day audit and 90-day terminal-job retention behavior.

Apply migration 044 before deploying this application version. Then open
**Settings → Production Readiness** and confirm Database Schema reports v44.
The health check continuously attests the effective table privileges and fails
closed if they drift. No environment variable or scheduler change is required.

Application rollback is compatible with the additive attestation function and
restricted privileges, so leave migration 044 in place and redeploy the prior
build if necessary. To investigate a failed retention run, inspect the latest
keepalive details before changing privileges; do not grant direct delete access
to the application role as a workaround.

### Strict signed-session claims

The strict-claims release introduced claim format v2 with a random session ID, issuance time, and
bounded expiry. Both middleware and API authorization share the same validator,
which accepts only explicit `admin` or complete `user` claims. Deploying this
change intentionally invalidates older v1 cookies; users sign in again once.

No migration, environment variable, or scheduler change is required. After
deployment, confirm an existing browser is redirected to login, then verify a
fresh team-user login and break-glass admin login. Roll back by redeploying the
previous build; newly issued v2 cookies will be rejected by the previous v1
application, so users sign in again after either direction of rollback.

### Revocable server-side sessions

Apply migration `045_revocable_sessions.sql` before deploying the compatible
application. It creates the private `auth_sessions` registry, its retention and
attestation functions, and advances the database contract to v45. The registry
stores a session UUID, timestamps, actor type, workspace ID, and a keyed subject
hash; it never stores the signed cookie or a user email.

Every authenticated API request verifies that its signed v3 session is still
active. Logout revokes the current session before clearing the cookie. A password
change revokes every active session for that user and returns the browser to the
login screen. Registry failures return a temporary authorization error instead
of allowing access. Middleware still performs the fast signature check before a
page loads; API authorization is the authoritative revocation boundary.

Deployment intentionally invalidates earlier cookies, so each user signs in once
after release. Confirm **Settings → Production Readiness** reports schema v45,
then test login, logout, and password change. After logout, replaying the old
cookie against an authenticated API must return HTTP 401. The daily keepalive
removes registry rows seven days after expiry and records the count as
`retention.authSessions`.

No environment or scheduler change is required. Roll back by redeploying the
previous application; migration 045 is additive and may remain installed. A
rolled-back application does not enforce the registry, so complete rollback only
after considering whether any session was revoked for a security reason.

### Active session management

Settings shows the active sessions belonging to the signed-in account, marks the
current browser, and permits revoking one older session or every other session.
The API derives the keyed subject from the current signed cookie and never accepts
an email, workspace, or subject hash from the browser, so a caller cannot enumerate
or revoke another account's sessions. Current-session termination continues to use
the normal Sign Out action.

Session-management actions are recorded as `auth.session_revoke` audit events with
only the operation scope, outcome, and aggregate revoked count. Session UUIDs and
subject hashes are not written to the audit ledger. This feature uses the registry
from migration 045; it requires no additional migration, environment variable, or
scheduler change. Roll back by redeploying the previous application build.

### Bounded active sessions

Apply migration `046_bounded_active_sessions.sql` before deploying the compatible
application. It installs an `AFTER INSERT` trigger that caps each keyed account
subject at ten active sessions. The trigger takes a transaction-scoped advisory
lock for that subject before ranking sessions, so simultaneous successful logins
cannot both bypass the cap. Newest database-created sessions are retained and
older excess sessions are revoked with reason `session_limit`.

The migration repairs any existing subject above the limit before enabling the
trigger. Production Readiness continuously verifies the function, enabled
trigger, revocation constraint, and live ten-session invariant. After applying
the migration, confirm Settings reports schema v46 and this query returns no rows:

```sql
select subject_hash, count(*) as active_sessions
from public.auth_sessions
where revoked_at is null and expires_at > now()
group by subject_hash
having count(*) > 10;
```

No environment variable or scheduler change is required. The trigger is
compatible with the previous application, so migration 046 may remain installed
during rollback.

### Safe API error boundary

High-risk scrape, contributor-outreach, and share routes never return caught
exception text to the browser. Unexpected failures use a stable public message,
include the request ID already attached to the operation, disable caching, and
write the underlying failure through Talon's sanitized structured logger. Known
and intentionally public outcomes, such as invalid input, a missing scrape, or
an idempotency conflict, retain their explicit 4xx responses.

This release has no migration, environment-variable, or scheduler change. After
deployment, exercise one validation failure and confirm its useful 4xx message
is unchanged. When diagnosing an unexpected 500, copy the response `requestId`
and search Vercel logs for that value; do not add raw exception messages back to
API responses. Roll back by redeploying the previous application build.

### Sanitized identity and administrator logs

Authentication, login throttling, authorization, profile, teammate-management,
and Slack-test failures are emitted as structured JSON events. The logger
redacts credentials, bearer values, email addresses, URLs, and sensitive context
keys before serialization. Request IDs are retained so an operator can connect a
safe browser response to its server-side event without logging the user's email,
password, webhook URL, profile photo path, or raw provider response.

This release has no migration, environment-variable, or scheduler change. After
deployment, perform one failed login and one successful administrator action,
then confirm Vercel logs contain structured event names and request IDs without
the submitted credentials or email address. Roll back by redeploying the prior
application version.

### Sanitized scrape operations

Scrape-list, queue-control, GitHub-capacity, and watched-repository routes emit
structured, request-correlated events instead of raw database or provider error
objects. Unexpected 500 responses use the typed public error catalog and disable
caching. Explicit state conflicts—such as retrying an ineligible job or adding a
duplicate watched repository—remain stable 409 responses rather than reflecting
arbitrary exception text.

This release has no migration, environment-variable, or scheduler change. After
deployment, confirm normal dashboard, retry, cancellation, rate-limit, and
watched-repository behavior. Use a returned `requestId` to correlate any 500 with
Vercel logs. Roll back by redeploying the prior application version.

### Complete API logging boundary

Every API route now sends operational diagnostics through Talon's structured,
sanitizing logger. Project, contributor, pipeline, follow-up, audit, activity,
and search failures return stable catalogued messages with request IDs instead
of exposing provider or database details. Development metrics retain aggregate
counts, payload size, and duration without recording search terms or filters.
A repository-wide test prevents any API route from reintroducing direct console
logging.

This release has no migration, environment-variable, or scheduler change. After
deployment, verify Projects, Pipeline, Search, contributor profiles, and project
lists load normally. Correlate any safe 500 response with Vercel logs using its
`requestId`. Roll back by redeploying the prior application version.

### Catalogued server-error responses

All API 5xx responses now use one reviewed response contract. Unexpected
failures and known service outages return a stable public message, machine code,
request ID, and `private, no-store` cache policy. This includes GitHub and Slack
provider rejection, keepalive maintenance failures, unavailable session
operations, missing profile/tracking schema, and ordinary internal failures.
Routes cannot choose an ad hoc 5xx body or accidentally expose implementation
details; a repository-wide test enforces the boundary.

This release has no migration, environment-variable, or scheduler change. After
deployment, confirm Settings reports healthy GitHub access and active sessions,
then run the normal production smoke workflow. Use a returned `requestId` to
correlate a service failure with structured Vercel logs. Roll back by redeploying
the prior application version.

### Retryable Project failures

The Project workspace no longer treats failed reads or mutations as successful
empty results. Project-shell, available-scrape, add, remove, and delete requests
validate the server response, preserve actionable error text, release their busy
state, and provide an explicit retry path. Failed deletion keeps the operator on
the Project instead of navigating away, and failed scrape changes do not refresh
the UI into a misleading state. Contributor outreach failures remain visible
without writing recruiter notes or contributor identifiers to the browser
console.

This release has no migration, environment-variable, or scheduler change. After
deployment, open a Project, add and remove one scrape, and confirm its contributor
list refreshes. Roll back by redeploying the prior application version.

### Reliable Projects library

The Projects library now distinguishes an unavailable server from a genuinely
empty workspace. List, create, and delete requests validate both HTTP status and
required response shape before changing local state. Failures remain visible
with a reload action, creation keeps the entered name for correction or retry,
and failed deletion leaves the Project card intact while releasing its busy
control.

This release has no migration, environment-variable, or scheduler change. After
deployment, open Projects, create a temporary Project, open it, return to the
library, and delete it. Roll back by redeploying the prior application version.

### Preserved Projects library snapshots

The Projects library preserves its last fully validated project cards when a
later refresh fails. Retained cards remain usable, the warning shows when the
snapshot was last updated, and Retry fetches a replacement without first hiding
known data. Every project summary is validated before the snapshot changes, and
create or delete failures remain scoped to those actions instead of making the
library appear unavailable.

This release has no migration, environment-variable, or scheduler change. After
deployment, open Projects, create a temporary Project, refresh the library, and
delete the temporary Project. Roll back by redeploying the prior application
version.

### Retryable watched-repository refreshes

Watched Repositories now reports initial-load and background-poll failures in
the interface instead of writing them only to the browser console. A failed poll
preserves the last known repository and check state, shows a retry action, and
clears the warning after the next successful refresh. Empty-state messaging is
shown only after a successful response. Add, delete, and manual-check operations
also validate response bodies, retain user input or repository rows on failure,
and recover their busy controls.

This release has no migration, environment-variable, or scheduler change. After
deployment, open Watched Repositories, add a temporary public repository, run
Check Now, wait for its status to settle, and remove it. Roll back by redeploying
the prior application version.

### Retryable scrape operations

The admin Scrape Operations panel now distinguishes an unavailable queue from
an empty queue. A failed initial load remains visible with a retry action, while
a failed background poll preserves and timestamps the last successful snapshot
instead of making stale job data look current. Retry and cancellation failures
also show the API's sanitized public message and always recover their controls.

This release has no migration, environment-variable, or scheduler change. After
deployment, start a scrape, confirm its operation updates, and exercise Cancel
or Retry on an eligible job. Roll back by redeploying the prior application
version.

### Reliable production diagnostics

Production Readiness preserves the last successful health snapshot when its
automatic refresh fails. The panel marks the snapshot as stale, keeps the
original check time visible, and lets the operator retry immediately. Initial
load failures are shown as unavailable diagnostics rather than an empty or
healthy state, and malformed responses fail closed.

This release has no migration, environment-variable, or scheduler change. After
deployment, open Settings as an admin, refresh Production Readiness, and confirm
the check time advances. Roll back by redeploying the prior application version.

### Reliable active-scrape progress

Active Scrapes preserves the last successful progress snapshot when polling
fails, marks the retained data with its update time, and provides an immediate
retry action. An initial polling failure remains visible instead of making the
section disappear. Poll responses are validated before progress changes, and
Cancel and Retry failures retain sanitized API messages.

This release has no migration, environment-variable, or scheduler change. After
deployment, start a public-repository scrape, watch its progress update, and
exercise an eligible Cancel or Retry action. Roll back by redeploying the prior
application version.

### Verified scrape acceptance

The scrape form treats a request as accepted only after the API returns HTTP
202 with a non-empty scrape ID, job ID, explicit queued status, and replay flag.
Malformed success responses fail closed: the entered target and idempotency key
remain available for a safe retry, and the UI does not announce a scrape that it
cannot prove was queued. Project creation follows the same response-validation
rule, and sanitized API messages remain visible to the user.

This release has no migration, environment-variable, or scheduler change. After
deployment, start a public-repository scrape and confirm the success message is
followed by an Active Scrape entry. Roll back by redeploying the prior
application version.

### Retryable scrape-form context

The scrape form now reports when recent-scrape duplicate detection or existing
Project options cannot load. Each warning has an independent retry action, and
the last successfully loaded context remains available during later failures.
Malformed payloads are rejected instead of being interpreted as an empty scrape
history or Project library. These supporting failures do not prevent an
operator from starting an otherwise valid unassigned scrape.

This release has no migration, environment-variable, or scheduler change. After
deployment, open the home page, confirm existing Projects appear in the scrape
form, and enter a recently completed target to confirm its duplicate warning.
Roll back by redeploying the prior application version.

### Reliable completed-scrape lists

Completed Scrapes preserves its last valid list when initial loading, background
polling, or pagination fails. The interface marks retained data with its last
successful update time and exposes an immediate retry. A failed or malformed
response is never interpreted as an empty workspace, and pagination state only
changes after a validated response.

This release has no migration, environment-variable, or scheduler change. After
deployment, open both Completed Scrapes tabs, load another page when available,
and confirm the list remains stable across its automatic refresh. Roll back by
redeploying the prior application version.

### Resumable contributor pagination

Expanded completed scrapes validate every contributor page before adding it to
the bounded client cache. If a later page fails, contributors from earlier pages
remain visible and the error records the failed page and sanitized API message.
Retry resumes at that page instead of discarding useful data and downloading the
list again from the beginning.

This release has no migration, environment-variable, or scheduler change. After
deployment, expand a completed scrape with contactable contributors, confirm
progressive loading settles, and verify search and CSV export still use the full
loaded list. Roll back by redeploying the prior application version.

### Retryable completed-list Project context

Completed Scrapes preserves its last successfully loaded Project options when
the Project service fails. The Project filter and assignment menus remain
usable with the retained data, while a visible warning and busy-safe retry make
the stale state explicit. Malformed Project responses are rejected rather than
being interpreted as an empty Project library.

This release has no migration, environment-variable, or scheduler change. After
deployment, confirm the Completed Scrapes Project filter lists existing Projects
and that a completed scrape can still be assigned to one. Roll back by
redeploying the prior application version.

### Verified completed-list mutations

Completed Scrapes changes local state only after outreach updates and scrape
deletions return their explicit success contract. Failed or malformed responses
retain the contributor cache, scrape row, and delete confirmation so the
operator can retry safely. Sanitized API messages remain visible, while raw
errors are no longer written to the browser console.

This release has no migration, environment-variable, or scheduler change. After
deployment, save one outreach field, refresh to confirm persistence, then delete
a disposable completed scrape and confirm it disappears. Roll back by
redeploying the prior application version.

### Verified scrape sharing

Share history, creation, and revocation now validate their complete response
contracts before changing modal state. Invalid success responses cannot create
an unusable public URL or mark a link revoked locally. History failures remain
visible with a retry action, revocation controls recover after failure, and all
paths preserve sanitized API messages without raw browser-console logging.

This release has no migration, environment-variable, or scheduler change. After
deployment, open a completed scrape's Share dialog, generate a temporary link,
open it, revoke it, and confirm the history shows Revoked. Roll back by
redeploying the prior application version.

### Reliable Pipeline snapshots

The Pipeline preserves its last validated items, Project options, totals, and
pagination state when initial loading, filtering, searching, or pagination
fails. The warning distinguishes a stale refresh from filters that were never
successfully applied and provides a direct retry. Malformed payloads fail closed
instead of clearing the Pipeline, and mutation errors remain scoped to their
action rather than marking the entire Pipeline unavailable.

This release has no migration, environment-variable, or scheduler change. After
deployment, open Pipeline, exercise Project, status, due-date, and search
filters, load another page if available, and update one follow-up. Roll back by
redeploying the prior application version.

### Reliable follow-up queue snapshots

The dashboard Follow-Ups Due queue preserves its last fully validated snapshot
when a refresh fails. Retained follow-ups remain actionable and show their last
successful update time. Malformed items, mismatched Project or contributor
identities, and failed requests cannot replace the queue or produce the
reassuring "You're clear" state; the existing Refresh control retries safely.

This release has no migration, environment-variable, or scheduler change. After
deployment, open the dashboard, refresh Follow-Ups Due, open one contributor
preview if present, and confirm View Pipeline still works. Roll back by
redeploying the prior application version.

### Critical-path browser testing

`pnpm test:e2e` starts an isolated local Talon server and runs Chromium through
login, scrape acceptance, active progress, completion, contributor expansion,
and CSV export. Network responses are deterministic browser fixtures, so the
test proves UI integration without GitHub, Supabase data, production secrets,
or production mutations. Controlled 503 responses prove that active progress
polling and Pipeline filter failures retain their last valid snapshot, never
substitute a false empty state, and recover through the visible Retry action.
CI installs only Chromium, retains traces, screenshots,
and video on failure, and uploads the HTML report for seven days.

Install the local browser once with `pnpm exec playwright install chromium`.
Use `pnpm test:e2e:ui` for interactive debugging. This release has no migration,
environment-variable, or scheduler change. Roll back by reverting the browser
test, configuration, dependency, and CI job; the production application is
otherwise unchanged.

## Watched Repo Recovery

If `Check Now` appears stale:

1. Refresh the app and inspect the watched repo status and `last checked` value.
2. Check Settings security events for `watched_repo.check`.
3. Confirm `SLACK_WEBHOOK_URL` is valid in Vercel if Slack notifications are expected.
4. Confirm the one-minute worker schedule is active and Settings shows a recent worker run.
5. Check Vercel function logs for `/api/watched-repos/check` and `/api/scrape-jobs/run`.
6. If the check succeeded but Slack did not arrive, inspect the Notification Queue health check and `notification_deliveries` query above.

Manual checks force-queue active watched repos and return immediately. The UI
polls persistent status; closing the browser does not interrupt the check. Cron
checks respect each repository interval.

## Secret Rotation

Database backup, isolated restore drills, recovery targets, external
configuration inventory, and post-restore queue reconciliation are documented
in [Disaster recovery](disaster-recovery.md). A checksum is necessary but does
not satisfy the quarterly drill until the archive has been restored and read by
an isolated Talon deployment.

Rotate these first if credentials are exposed:

1. GitHub personal access tokens.
2. `CRON_SECRET`.
3. `TALON_ADMIN_PASSWORD`.
4. `TALON_SESSION_SECRET`.
5. `SLACK_WEBHOOK_URL`.
6. `SUPABASE_SERVICE_ROLE_KEY`.

After rotating Vercel environment variables, redeploy the app.
