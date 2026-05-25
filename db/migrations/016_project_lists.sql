-- Project-scoped saved contributor lists.
-- Lists belong to one Project (ecosystem) and are never global.

CREATE TABLE IF NOT EXISTS public.project_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  ecosystem_id UUID NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0 AND length(name) <= 120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ecosystem_id, name)
);

CREATE TABLE IF NOT EXISTS public.project_list_contributors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  project_list_id UUID NOT NULL REFERENCES public.project_lists(id) ON DELETE CASCADE,
  contributor_id UUID NOT NULL REFERENCES public.contributors(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_list_id, contributor_id)
);

CREATE INDEX IF NOT EXISTS idx_project_lists_team_ecosystem
  ON public.project_lists(team_id, ecosystem_id, name);

CREATE INDEX IF NOT EXISTS idx_project_list_contributors_team_list
  ON public.project_list_contributors(team_id, project_list_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_list_contributors_contributor
  ON public.project_list_contributors(team_id, contributor_id);

ALTER TABLE public.project_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_list_contributors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_lists_select_for_team_member" ON public.project_lists;
CREATE POLICY "project_lists_select_for_team_member"
ON public.project_lists
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "project_list_contributors_select_for_team_member" ON public.project_list_contributors;
CREATE POLICY "project_list_contributors_select_for_team_member"
ON public.project_list_contributors
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));
