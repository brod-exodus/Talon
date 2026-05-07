CREATE TABLE IF NOT EXISTS scrape_job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  scrape_id TEXT REFERENCES scrapes(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrape_job_events_job_created_at
  ON scrape_job_events(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_job_events_scrape_created_at
  ON scrape_job_events(scrape_id, created_at DESC);

ALTER TABLE scrape_job_events ENABLE ROW LEVEL SECURITY;
