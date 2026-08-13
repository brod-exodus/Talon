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

## Post-Deploy Smoke Checklist

Run this after every production deploy:

1. Run `pnpm smoke:production` and save the pass/fail result in the PR or release notes.
2. Open Settings and verify Recent Security Events includes the smoke actions.
3. Download one CSV from the UI and open it to confirm the browser download path.
4. Run Watched Repos `Check Now` and confirm `last checked` updates.
5. Verify Vercel deploy checks are green and no unresolved preview comments remain.

## Database Migrations

Apply migrations in order from `db/migrations`.

Security hardening migrations include:

```text
db/migrations/007_security_events.sql
db/migrations/010_service_role_rls_lockdown.sql
db/migrations/024_system_runs.sql
db/migrations/025_contactable_scrape_contributors_rpc.sql
db/migrations/026_share_lifecycle_and_retention.sql
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

## Auth Lockouts

Admin login allows 5 failed attempts per hashed client IP in a 15 minute window. After that, login is locked for 15 minutes and `/api/auth/login` returns `429`.

Successful login clears the rate-limit record for that client.

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
