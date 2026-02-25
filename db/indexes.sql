-- Run these in the Supabase SQL editor to speed up the scrapes list and contributor lookups.

-- Most impactful: scrape_contributors is joined/counted on every list load.
-- Without this, each scrape requires a full table scan of scrape_contributors.
CREATE INDEX IF NOT EXISTS idx_scrape_contributors_scrape_id
  ON scrape_contributors(scrape_id);

-- Needed when looking up which scrapes a contributor appears in.
CREATE INDEX IF NOT EXISTS idx_scrape_contributors_contributor_id
  ON scrape_contributors(contributor_id);

-- Used in WHERE status = 'active'/'completed' filters.
CREATE INDEX IF NOT EXISTS idx_scrapes_status
  ON scrapes(status);

-- Used for ORDER BY started_at DESC on the list query.
CREATE INDEX IF NOT EXISTS idx_scrapes_started_at
  ON scrapes(started_at DESC);

-- Watched repos: interval check filter.
CREATE INDEX IF NOT EXISTS idx_watched_repos_active
  ON watched_repos(active);

CREATE INDEX IF NOT EXISTS idx_watched_repos_last_checked_at
  ON watched_repos(last_checked_at);

-- Watched repo contributors: looked up per watched_repo_id on every cron run.
CREATE INDEX IF NOT EXISTS idx_watched_repo_contributors_watched_repo_id
  ON watched_repo_contributors(watched_repo_id);
