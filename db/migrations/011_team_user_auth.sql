-- Per-user auth foundation for recruiter team access.
-- Run after db/migrations/010_service_role_rls_lockdown.sql.

UPDATE public.team_memberships
SET email = lower(trim(email))
WHERE email <> lower(trim(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_memberships_team_lower_email
  ON public.team_memberships(team_id, lower(email));

CREATE INDEX IF NOT EXISTS idx_team_memberships_lower_email
  ON public.team_memberships(lower(email));
