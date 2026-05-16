-- Phase 2 foundation for multi-user team support.
-- This migration is backward-compatible with the current single-admin model.

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'recruiter', 'viewer')),
  invited_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, email)
);

INSERT INTO teams (slug, name)
VALUES ('default', 'Default Team')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE scrapes
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE scrape_jobs
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE scrape_job_contributions
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE scrape_job_events
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE shared_scrapes
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE ecosystems
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE ecosystem_scrapes
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE watched_repos
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE watched_repo_contributors
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

ALTER TABLE contributors
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE CASCADE;

DO $$
DECLARE
  default_team UUID;
BEGIN
  SELECT id INTO default_team FROM teams WHERE slug = 'default' LIMIT 1;

  UPDATE scrapes SET team_id = default_team WHERE team_id IS NULL;
  UPDATE scrape_jobs SET team_id = default_team WHERE team_id IS NULL;
  UPDATE scrape_job_contributions SET team_id = default_team WHERE team_id IS NULL;
  UPDATE scrape_job_events SET team_id = default_team WHERE team_id IS NULL;
  UPDATE shared_scrapes SET team_id = default_team WHERE team_id IS NULL;
  UPDATE ecosystems SET team_id = default_team WHERE team_id IS NULL;
  UPDATE ecosystem_scrapes SET team_id = default_team WHERE team_id IS NULL;
  UPDATE watched_repos SET team_id = default_team WHERE team_id IS NULL;
  UPDATE watched_repo_contributors SET team_id = default_team WHERE team_id IS NULL;
  UPDATE contributors SET team_id = default_team WHERE team_id IS NULL;
END $$;

ALTER TABLE scrapes ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE scrape_jobs ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE scrape_job_contributions ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE scrape_job_events ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE shared_scrapes ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE ecosystems ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE ecosystem_scrapes ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE watched_repos ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE watched_repo_contributors ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE contributors ALTER COLUMN team_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scrapes_team_started_at
  ON scrapes(team_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_team_status_run_after
  ON scrape_jobs(team_id, status, run_after, created_at);

CREATE INDEX IF NOT EXISTS idx_scrape_job_events_team_created_at
  ON scrape_job_events(team_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ecosystems_team_name
  ON ecosystems(team_id, name);

CREATE INDEX IF NOT EXISTS idx_watched_repos_team_active_checked
  ON watched_repos(team_id, active, last_checked_at);

CREATE INDEX IF NOT EXISTS idx_contributors_team_username
  ON contributors(team_id, github_username);

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_memberships ENABLE ROW LEVEL SECURITY;
