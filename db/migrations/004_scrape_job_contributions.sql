CREATE TABLE IF NOT EXISTS scrape_job_contributions (
  job_id UUID NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  github_login TEXT NOT NULL,
  contributions INTEGER NOT NULL CHECK (contributions >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, github_login)
);

CREATE INDEX IF NOT EXISTS idx_scrape_job_contributions_job_contributions
  ON scrape_job_contributions(job_id, contributions DESC);

ALTER TABLE scrape_job_contributions ENABLE ROW LEVEL SECURITY;
