-- Talon production baseline schema.
-- Apply through Supabase migrations or the SQL editor before deploying the app.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS scrapes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('organization', 'repository')),
  target TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'failed', 'canceled')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  current INTEGER NOT NULL DEFAULT 0 CHECK (current >= 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  current_user_login TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error TEXT,
  min_contributions INTEGER NOT NULL DEFAULT 1 CHECK (min_contributions >= 1),
  contact_info_count INTEGER NOT NULL DEFAULT 0 CHECK (contact_info_count >= 0),
  total_contributors INTEGER NOT NULL DEFAULT 0 CHECK (total_contributors >= 0)
);

CREATE TABLE IF NOT EXISTS contributors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  github_username TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  bio TEXT,
  location TEXT,
  company TEXT,
  email TEXT,
  twitter TEXT,
  linkedin TEXT,
  website TEXT,
  contacted BOOLEAN NOT NULL DEFAULT FALSE,
  contacted_date DATE,
  outreach_notes TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scrape_contributors (
  scrape_id TEXT NOT NULL REFERENCES scrapes(id) ON DELETE CASCADE,
  contributor_id UUID NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
  contributions INTEGER NOT NULL CHECK (contributions >= 0),
  PRIMARY KEY (scrape_id, contributor_id)
);

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

CREATE TABLE IF NOT EXISTS scrape_job_contributions (
  job_id UUID NOT NULL REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  github_login TEXT NOT NULL,
  contributions INTEGER NOT NULL CHECK (contributions >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, github_login)
);

CREATE TABLE IF NOT EXISTS scrape_job_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  scrape_id TEXT REFERENCES scrapes(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shared_scrapes (
  id TEXT PRIMARY KEY,
  scrape_id TEXT NOT NULL REFERENCES scrapes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ecosystems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ecosystem_scrapes (
  ecosystem_id UUID NOT NULL REFERENCES ecosystems(id) ON DELETE CASCADE,
  scrape_id TEXT NOT NULL REFERENCES scrapes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ecosystem_id, scrape_id)
);

CREATE TABLE IF NOT EXISTS watched_repos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo TEXT NOT NULL UNIQUE,
  interval_hours INTEGER NOT NULL CHECK (interval_hours IN (1, 6, 12, 24, 48)),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS watched_repo_contributors (
  watched_repo_id UUID NOT NULL REFERENCES watched_repos(id) ON DELETE CASCADE,
  github_username TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (watched_repo_id, github_username)
);

CREATE INDEX IF NOT EXISTS idx_scrapes_started_at
  ON scrapes(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrapes_status_started_at
  ON scrapes(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_contributors_github_username
  ON contributors(github_username);

CREATE INDEX IF NOT EXISTS idx_scrape_contributors_scrape_id
  ON scrape_contributors(scrape_id);

CREATE INDEX IF NOT EXISTS idx_scrape_contributors_scrape_id_contributions
  ON scrape_contributors(scrape_id, contributions DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_contributors_contributor_id
  ON scrape_contributors(contributor_id);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status_run_after
  ON scrape_jobs(status, run_after, created_at);

CREATE INDEX IF NOT EXISTS idx_scrape_job_contributions_job_contributions
  ON scrape_job_contributions(job_id, contributions DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_job_events_job_created_at
  ON scrape_job_events(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_job_events_scrape_created_at
  ON scrape_job_events(scrape_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shared_scrapes_scrape_id
  ON shared_scrapes(scrape_id);

CREATE INDEX IF NOT EXISTS idx_ecosystem_scrapes_ecosystem_id
  ON ecosystem_scrapes(ecosystem_id);

CREATE INDEX IF NOT EXISTS idx_ecosystem_scrapes_scrape_id
  ON ecosystem_scrapes(scrape_id);

CREATE INDEX IF NOT EXISTS idx_watched_repos_active_last_checked
  ON watched_repos(active, last_checked_at);

CREATE INDEX IF NOT EXISTS idx_watched_repo_contributors_watched_repo_id
  ON watched_repo_contributors(watched_repo_id);

ALTER TABLE scrapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_job_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared_scrapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecosystems ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecosystem_scrapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE watched_repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE watched_repo_contributors ENABLE ROW LEVEL SECURITY;

-- No anon policies are created intentionally. Talon server routes use
-- SUPABASE_SERVICE_ROLE_KEY and enforce the app's admin session before access.

CREATE OR REPLACE FUNCTION get_scrape_contributors_page(
  p_scrape_id TEXT,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  contributor_id UUID,
  github_username TEXT,
  name TEXT,
  avatar_url TEXT,
  bio TEXT,
  location TEXT,
  company TEXT,
  email TEXT,
  twitter TEXT,
  linkedin TEXT,
  website TEXT,
  contacted BOOLEAN,
  contacted_date DATE,
  outreach_notes TEXT,
  status TEXT,
  contributions INTEGER,
  contributor_total BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.id AS contributor_id,
    c.github_username,
    c.name,
    c.avatar_url,
    c.bio,
    c.location,
    c.company,
    c.email,
    c.twitter,
    c.linkedin,
    c.website,
    c.contacted,
    c.contacted_date,
    c.outreach_notes,
    c.status,
    sc.contributions,
    COUNT(*) OVER () AS contributor_total
  FROM scrape_contributors sc
  JOIN contributors c ON c.id = sc.contributor_id
  WHERE sc.scrape_id = p_scrape_id
  ORDER BY sc.contributions DESC, c.github_username ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 500)
  OFFSET GREATEST(p_offset, 0);
$$;
