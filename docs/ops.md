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
```

They create or enforce:

- `audit_events`: recent admin, cron, scrape, share, watched-repo, and outreach events.
- `auth_rate_limits`: persistent failed-login counters and temporary lockouts.
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

## Browser security boundary

Talon rejects cross-site state-changing browser requests before team
authorization runs. Same-origin requests continue normally, while originless
writes fail closed. The production smoke workflow supplies its expected origin;
cron routes continue to authenticate through `CRON_SECRET`. Public login,
signup, and logout routes apply the same check.

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
3. Check GitHub rate-limit capacity, queue age, and worker freshness in the same
   panel.
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

## Watched Repo Recovery

If `Check Now` appears stale:

1. Refresh the app and inspect the watched repo `last checked` value.
2. Check Settings security events for `watched_repo.check`.
3. Confirm `SLACK_WEBHOOK_URL` is valid in Vercel if Slack notifications are expected.
4. Check Vercel function logs for `/api/watched-repos/check`.

Manual checks force-check active watched repos. Cron checks respect each repo interval.

## Secret Rotation

Rotate these first if credentials are exposed:

1. GitHub personal access tokens.
2. `CRON_SECRET`.
3. `TALON_ADMIN_PASSWORD`.
4. `TALON_SESSION_SECRET`.
5. `SLACK_WEBHOOK_URL`.
6. `SUPABASE_SERVICE_ROLE_KEY`.

After rotating Vercel environment variables, redeploy the app.
