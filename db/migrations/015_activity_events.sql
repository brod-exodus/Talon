-- Lightweight team activity feed for product-facing header notifications.

CREATE TABLE IF NOT EXISTS public.activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  actor_email TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_events_team_created_at
  ON public.activity_events(team_id, created_at DESC);

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_events_select_for_team_member" ON public.activity_events;
CREATE POLICY "activity_events_select_for_team_member"
ON public.activity_events
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));
