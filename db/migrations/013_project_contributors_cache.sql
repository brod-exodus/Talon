-- Cached Project contributor intelligence.
-- Stores precomputed project contributor overlap so Project pages avoid
-- rebuilding cross-scrape contributor aggregates on every page load.

CREATE TABLE IF NOT EXISTS public.project_contributors_cache (
  ecosystem_id UUID PRIMARY KEY REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  scrape_ids TEXT[] NOT NULL DEFAULT '{}',
  contributors JSONB NOT NULL DEFAULT '[]'::jsonb,
  contributor_count INTEGER NOT NULL DEFAULT 0 CHECK (contributor_count >= 0),
  multi_repo_count INTEGER NOT NULL DEFAULT 0 CHECK (multi_repo_count >= 0),
  recomputed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_contributors_cache_team
  ON public.project_contributors_cache(team_id, recomputed_at DESC);

ALTER TABLE public.project_contributors_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_contributors_cache_select_for_team_member" ON public.project_contributors_cache;
CREATE POLICY "project_contributors_cache_select_for_team_member"
ON public.project_contributors_cache
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));
