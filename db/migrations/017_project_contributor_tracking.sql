-- Project-scoped contributor outreach tracking.
-- One contributor can have different recruiting status/notes per Project.

CREATE TABLE IF NOT EXISTS public.project_contributor_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  ecosystem_id UUID NOT NULL REFERENCES public.ecosystems(id) ON DELETE CASCADE,
  contributor_id UUID NOT NULL REFERENCES public.contributors(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_contacted' CHECK (
    status IN (
      'not_contacted',
      'contacted',
      'replied',
      'interested',
      'interviewing',
      'rejected',
      'archived'
    )
  ),
  notes TEXT,
  last_contacted_at DATE,
  next_follow_up_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ecosystem_id, contributor_id)
);

CREATE INDEX IF NOT EXISTS idx_project_contributor_tracking_team_project
  ON public.project_contributor_tracking(team_id, ecosystem_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_contributor_tracking_follow_up
  ON public.project_contributor_tracking(team_id, next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL;

ALTER TABLE public.project_contributor_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "project_contributor_tracking_select_for_team_member" ON public.project_contributor_tracking;
CREATE POLICY "project_contributor_tracking_select_for_team_member"
ON public.project_contributor_tracking
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));
