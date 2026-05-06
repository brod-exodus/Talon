CREATE TABLE IF NOT EXISTS scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_id TEXT NOT NULL UNIQUE REFERENCES scrapes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('organization', 'repository')),
  target TEXT NOT NULL,
  min_contributions INTEGER NOT NULL DEFAULT 1 CHECK (min_contributions >= 1),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status_run_after
  ON scrape_jobs(status, run_after, created_at);

ALTER TABLE scrape_jobs ENABLE ROW LEVEL SECURITY;
