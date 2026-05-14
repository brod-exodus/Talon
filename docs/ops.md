# Talon Ops Runbook

## Production Smoke Check

1. Open `/api/health` while logged in and confirm every check is `ok`.
2. Start a small repository scrape and confirm it moves from queued to running to completed.
3. Force a bad repository scrape and confirm retry controls appear.
4. Run Watched Repos `Check Now` and confirm `last checked` updates.
5. Create a share link and open it in a private browser window.

## Post-Deploy Smoke Checklist

Run this after every production deploy:

1. Open `/api/health` and confirm all checks are `ok`.
2. Login with the admin password.
3. Verify `Settings -> Recent Security Events` loads and logs new actions.
4. Run a small scrape and confirm queued -> running -> completed.
5. Force a failing scrape and confirm retry path works.
6. Run Watched Repos `Check Now` and confirm `last checked` updates.
7. Create a share link and verify read-only access in a private window.
8. Verify Vercel deploy checks are green and no unresolved preview comments remain.

## Database Migrations

Apply migrations in order from `db/migrations`.

The security hardening migration is:

```text
db/migrations/007_security_events.sql
```

It creates:

- `audit_events`: recent admin, cron, scrape, share, watched-repo, and outreach events.
- `auth_rate_limits`: persistent failed-login counters and temporary lockouts.

If Settings cannot load recent security events, confirm this migration has been applied.

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
- `outreach.update`

## Scrape Recovery

If a scrape is stuck:

1. Check the active scrape card for the job status and latest error.
2. Use Retry if the scrape is failed or retry scheduled.
3. Use Cancel if the scrape is running too long or has clearly bad input.
4. Check Settings security events for `scrape_worker.run` and `scrape.retry`.
5. Check Vercel function logs for `/api/scrape`, `/api/scrape-jobs/run`, and `/api/scrape-jobs/[id]/retry`.

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
