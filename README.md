# Talon

Talon is a GitHub contributor discovery and monitoring app. It helps you scrape repositories and organizations, enrich contributor profiles with contact signals, group talent into ecosystems, track outreach state, and watch repos for new contributors over time.

## What Talon Does

- Scrape GitHub organizations or individual repositories
- Enrich contributors with email, Twitter/X, LinkedIn, website, bio, and company data
- Track contributor outreach state and notes
- Group scrapes into ecosystems to surface cross-repo overlap
- Monitor watched repos for newly appearing contributors
- Share curated contributor lists with public links

## Stack

- Next.js 15
- TypeScript
- Supabase
- Tailwind CSS
- shadcn/ui
- GitHub REST API

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Configure your environment variables in `.env.local`. Start from `.env.example`.
3. Start the dev server:
   ```bash
   pnpm dev
   ```
4. Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Required for production:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser/server | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser/server | Public Supabase anon key. Required by Supabase clients, but not used for privileged Talon server data access. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Server-side database client for protected routes, jobs, and cron work. |
| `TALON_ADMIN_PASSWORD` | Server only | Password for the built-in admin login. |
| `TALON_SESSION_SECRET` | Server only | Secret used to sign admin session cookies. Use a long random value. |
| `CRON_SECRET` | Server only | Bearer secret for protected cron endpoints. |
| `GITHUB_TOKEN` | Server only | GitHub token used by durable scrape jobs and watched-repo checks. |

Optional:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `SLACK_WEBHOOK_URL` | Server only | Slack webhook for automated watched-repo alerts. |

## Credential Model

- GitHub tokens entered in Settings are browser-managed.
- By default, Talon stores the token only for the current tab session.
- Users can optionally persist the token in local browser storage on that machine.
- Private app APIs require the signed admin session cookie created from `TALON_ADMIN_PASSWORD`.
- Server-side database reads and writes require `SUPABASE_SERVICE_ROLE_KEY`.
- Recruiter accounts can sign in with Supabase Auth email/password when their email exists in `team_memberships`.
- The shared admin password remains available as break-glass access when the login email field is blank.
- Server-side watched-repo checks use `GITHUB_TOKEN` from the deployment environment.
- Automated Slack alerts use `SLACK_WEBHOOK_URL` from the deployment environment.
- Cron invocations of watched-repo checks should send `Authorization: Bearer $CRON_SECRET`.
- Durable scrape jobs are queued in `scrape_jobs` and processed by `/api/scrape-jobs/run`.
- The scrape worker uses server-side `GITHUB_TOKEN`; browser-entered GitHub tokens are not persisted into the job queue.

## Database Setup

Apply migrations in order before deploying the app:

1. `db/migrations/001_initial_schema.sql`
2. `db/migrations/002_scrape_jobs.sql`
3. `db/migrations/003_scrape_job_resume_cancel.sql`
4. `db/migrations/004_scrape_job_contributions.sql`
5. `db/migrations/005_scrape_contributors_page_rpc.sql`
6. `db/migrations/006_scrape_job_events.sql`
7. `db/migrations/007_security_events.sql`
8. `db/migrations/008_team_foundation.sql`
9. `db/migrations/009_team_unique_constraints.sql`
10. `db/migrations/010_service_role_rls_lockdown.sql`
11. `db/migrations/011_team_user_auth.sql`

The baseline schema enables RLS and intentionally creates no broad anon policies. Talon server routes use `SUPABASE_SERVICE_ROLE_KEY` and enforce the app admin session before reading or mutating private data. Migration `010` removes temporary app-wide anon/auth policies and adds authenticated team-member read policies for the future Supabase Auth rollout.

## Cron Jobs

`vercel.json` defines the daily cron route supported by Vercel Hobby:

| Route | Schedule | Purpose |
| --- | --- | --- |
| `/api/watched-repos/check` | Daily at 09:00 UTC | Checks watched repos for new contributors and can send Slack alerts. |

Cron endpoints accept `Authorization: Bearer $CRON_SECRET`.

Durable scrape jobs are processed by `POST /api/scrape-jobs/run`. That endpoint is intentionally not listed in `vercel.json` because Vercel Hobby accounts only support daily cron schedules, and scrape queues need a more frequent worker cadence. Use one of these options:

- Vercel Pro: add `/api/scrape-jobs/run` with a frequent schedule such as `*/5 * * * *`.
- External scheduler: call `POST /api/scrape-jobs/run` every few minutes with `Authorization: Bearer $CRON_SECRET`.
- Manual admin run: call the endpoint from an authenticated admin session during testing.

## Health Diagnostics

Authenticated admins can call `/api/health` to check production readiness without exposing secret values. The health response reports:

- required environment variable presence
- recommended secret lengths
- database reachability
- GitHub token validity and remaining core rate limit
- optional Slack webhook configuration state

The dashboard shows a Production Readiness panel when any check is warning or failing.

Scrape job events are stored in `scrape_job_events` and surfaced in the Worker Queue panel. Events include queueing, worker claims, phase transitions, retries, cancellations, failures, and success.

## Typical Workflow

1. Add a GitHub token in Settings.
2. Start a scrape for an org or repository.
3. Let the protected scrape worker process queued jobs.
4. Review contributors and contact signals.
5. Mark outreach progress and notes.
6. Group related scrapes into ecosystems.
7. Add watched repos to monitor for new contributors.

## Testing

Run local verification with:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

CI runs the same gates with `pnpm install --frozen-lockfile`.

## Production Checklist

- Apply all migrations in order.
- Set every required environment variable in the deployment platform.
- Use a strong `TALON_ADMIN_PASSWORD`, `TALON_SESSION_SECRET`, and `CRON_SECRET`.
- Confirm `SUPABASE_SERVICE_ROLE_KEY` is set and never exposed to the browser.
- Keep Supabase RLS enabled; do not add broad anon policies for private app tables.
- Confirm Vercel cron is enabled for watched-repo checks.
- Configure a frequent scrape-worker trigger for `/api/scrape-jobs/run` using Vercel Pro cron or an external scheduler.
- Configure `GITHUB_TOKEN` with enough rate limit for scrape jobs.
- Configure `SLACK_WEBHOOK_URL` only if watched-repo Slack alerts should be sent.
- Confirm `/api/health` reports `ok` after deployment.
- Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` before release.
