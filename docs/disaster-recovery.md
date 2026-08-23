# Talon Disaster Recovery

This runbook covers recovery of the operator-controlled portfolio deployment.
It is designed to prevent a backup file from being mistaken for a tested
recovery capability.

## Recovery objectives

- Recovery point objective (RPO): no more than 24 hours of application data.
- Recovery time objective (RTO): restore a usable operator deployment within 4 hours.
- Owner: the Talon operator.
- Drill frequency: quarterly and before any high-risk database migration.

These are engineering targets, not a customer-facing SLA. Record an exception
when the available Supabase plan cannot meet them.

## Sources of truth

| Asset | Recovery source |
| --- | --- |
| Application and migrations | GitHub `main` branch and tagged deployment commit |
| Talon `public` schema and data | Supabase platform backup plus the verified logical backup below |
| Supabase Auth identities | Supabase Auth/platform recovery; not included in the logical dump |
| Vercel environment values | Operator password manager and Vercel configuration; never the repository |
| Supabase Vault and worker schedule | Operator password manager and `docs/supabase-worker-schedule.md` |
| GitHub and Slack credentials | Reissue from each provider; never recover secrets from a data dump |

The logical backup is defense in depth. It intentionally exports only the
`public` schema, which contains Talon business and operational data. It does not
capture Supabase Auth, Vault secrets, cron jobs, provider settings, or Vercel
configuration.

## Create and verify a logical backup

Install PostgreSQL client tools containing `pg_dump` and `pg_restore`. Choose a
dedicated encrypted directory outside the Talon repository, then run:

```bash
cd /path/to/Talon-main
read -s "TALON_BACKUP_DATABASE_URL?Production database URL: "
export TALON_BACKUP_DATABASE_URL
TALON_BACKUP_OUTPUT_DIR="/path/to/encrypted/talon-backups" pnpm backup:database
unset TALON_BACKUP_DATABASE_URL
```

The script refuses an output directory inside the repository, uses restrictive
permissions, writes through a partial file, verifies the PostgreSQL archive,
and creates a SHA-256 sidecar. Verify it again from a separate process:

```bash
pnpm backup:verify -- /path/to/encrypted/talon-backups/talon-public-YYYYMMDDTHHMMSSZ.dump
```

Create one logical backup at least daily when Talon is active and immediately
before a migration. Store it in encrypted storage with access limited to the
operator. Do not commit, email, or attach it to a pull request because it may
contain recruiter notes and public contact data.

## Isolated restore drill

Never test a restore against Production. Create a disposable Supabase project,
label it clearly as a recovery drill, and confirm its database hostname twice.

1. Record the production commit, current schema version, backup timestamp, and
   backup checksum.
2. Create the isolated target and configure no GitHub, Slack, cron, or email
   credentials.
3. Restore the custom archive into that isolated database with `pg_restore`.
   `--clean --if-exists` is permitted only after the target has been verified as
   disposable and non-production.
4. Deploy the recorded Talon commit to a non-production Vercel environment using
   non-production Supabase keys.
5. Keep `GITHUB_TOKEN`, `CRON_SECRET`, and `SLACK_WEBHOOK_URL` unset so restored
   queued work cannot call external providers.
6. Run the validation queries below and the read-only application checks.
7. Delete the drill environment and its restored private data when evidence has
   been recorded.

Validation queries:

```sql
select public.get_talon_schema_version();
select * from public.get_talon_schema_contract_issues();

select status, count(*)
from public.scrape_jobs
group by status
order by status;

select count(*) as scrapes from public.scrapes;
select count(*) as contributors from public.contributors;
select count(*) as projects from public.ecosystems;
select count(*) as memberships from public.team_memberships;
```

The schema version must match the recorded deployment, the contract-issues query
must return no rows, and row counts must be plausible compared with Production.
Then verify login, Projects, Pipeline, completed scrapes, contributor expansion,
and CSV export using non-sensitive test data.

## Production recovery sequence

1. Declare the incident, stop deployments, and record the last known healthy
   commit and timestamp.
2. Disable the Supabase worker schedule and Vercel cron before restoring data.
3. Prefer the provider's point-in-time or platform restore when it is available.
   Use the verified logical dump when the platform recovery path is unavailable
   or as an independent comparison.
4. Restore Supabase Auth identities through the platform recovery path. If they
   cannot be restored, provision fresh identities and reconcile them with the
   restored `team_memberships`; do not weaken authentication to regain access.
5. Restore Vercel environment variables and Supabase Vault values from the
   password manager. Rotate credentials if loss or disclosure is possible.
6. Deploy the exact recorded application commit and confirm Settings reports the
   expected schema version with no contract issues.
7. Inspect queued, running, failed, and notification-delivery work before
   enabling schedulers. Let Talon's normal stale-lease recovery handle old
   running jobs; do not manually mark them complete.
8. Enable the one-minute worker schedule, observe queue depth and the oldest job,
   then enable keepalive and watched-repository scheduling.
9. Run `pnpm smoke:production` with a public test repository.
10. Record data loss, elapsed recovery time, credential rotations, and follow-up
    actions in the incident report.

## Quarterly drill record

Record this evidence without secrets or contributor data:

- Date, operator, source commit, and backup timestamp
- SHA-256 verification result and restorable-entry count
- Isolated target identifier
- Restored Talon schema version and contract result
- Application checks performed
- Measured recovery time and estimated data gap
- Deviations from the 24-hour RPO or 4-hour RTO
- Follow-up owner and due date

A checksum check alone is not a restore drill. The quarterly requirement is
complete only after the archive has been restored into an isolated database and
the application has read the restored data successfully.
