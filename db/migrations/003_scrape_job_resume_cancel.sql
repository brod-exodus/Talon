ALTER TABLE scrape_jobs
  ADD COLUMN IF NOT EXISTS state JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE scrape_jobs
  DROP CONSTRAINT IF EXISTS scrape_jobs_status_check;

ALTER TABLE scrape_jobs
  ADD CONSTRAINT scrape_jobs_status_check
  CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled'));

ALTER TABLE scrapes
  DROP CONSTRAINT IF EXISTS scrapes_status_check;

ALTER TABLE scrapes
  ADD CONSTRAINT scrapes_status_check
  CHECK (status IN ('active', 'completed', 'failed', 'canceled'));
