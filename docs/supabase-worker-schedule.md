# Supabase Worker Schedule

Talon's scrape starter only queues durable work. Supabase Cron invokes one
bounded worker step every minute so jobs continue without an open browser.

## Configure once in Supabase

1. Enable the `pg_cron` and `pg_net` extensions.
2. In SQL Editor, store the Production URL and the same `CRON_SECRET` used by
   Vercel. Replace both placeholder values before running:

```sql
select vault.create_secret('https://your-production-domain.example', 'talon_app_url');
select vault.create_secret('replace-with-vercel-cron-secret', 'talon_cron_secret');
```

3. Schedule the worker:

```sql
select cron.schedule(
  'talon-scrape-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'talon_app_url'
    ) || '/api/scrape-jobs/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'talon_cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
```

## Verify

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'talon-scrape-worker';

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (
  select jobid from cron.job where jobname = 'talon-scrape-worker'
)
order by start_time desc
limit 10;
```

Talon's admin Health panel should show a recent successful worker invocation.
To remove the schedule, run:

```sql
select cron.unschedule('talon-scrape-worker');
```
