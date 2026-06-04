-- Speed up global header search as team data grows.
-- These indexes support contains-style ILIKE queries used by /api/search.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_contributors_github_username_trgm
  ON public.contributors USING gin (github_username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_contributors_name_trgm
  ON public.contributors USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_scrapes_target_trgm
  ON public.scrapes USING gin (target gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_ecosystems_name_trgm
  ON public.ecosystems USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_watched_repos_repo_trgm
  ON public.watched_repos USING gin (repo gin_trgm_ops);
