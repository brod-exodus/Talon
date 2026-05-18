-- Lock down temporary app policies now that server routes use the service-role client.
-- Run after db/migrations/009_team_unique_constraints.sql.

DROP POLICY IF EXISTS "allow_read_teams_for_app" ON public.teams;
DROP POLICY IF EXISTS "teams_select_for_app" ON public.teams;
DROP POLICY IF EXISTS "scrapes_write_for_app" ON public.scrapes;
DROP POLICY IF EXISTS "scrape_jobs_write_for_app" ON public.scrape_jobs;
DROP POLICY IF EXISTS "scrape_jobs_read_for_app" ON public.scrape_jobs;

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_job_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrape_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_scrapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecosystems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ecosystem_scrapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watched_repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.watched_repo_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.talon_current_user_team_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tm.team_id
  FROM public.team_memberships tm
  WHERE lower(tm.email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

REVOKE ALL ON FUNCTION public.talon_current_user_team_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.talon_current_user_team_ids() TO authenticated;

DROP POLICY IF EXISTS "teams_select_for_team_member" ON public.teams;
CREATE POLICY "teams_select_for_team_member"
ON public.teams
FOR SELECT
TO authenticated
USING (id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "team_memberships_select_for_team_member" ON public.team_memberships;
CREATE POLICY "team_memberships_select_for_team_member"
ON public.team_memberships
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "scrapes_select_for_team_member" ON public.scrapes;
CREATE POLICY "scrapes_select_for_team_member"
ON public.scrapes
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "contributors_select_for_team_member" ON public.contributors;
CREATE POLICY "contributors_select_for_team_member"
ON public.contributors
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "scrape_contributors_select_for_team_member" ON public.scrape_contributors;
CREATE POLICY "scrape_contributors_select_for_team_member"
ON public.scrape_contributors
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.scrapes s
    WHERE s.id = scrape_contributors.scrape_id
      AND s.team_id IN (SELECT public.talon_current_user_team_ids())
  )
);

DROP POLICY IF EXISTS "scrape_jobs_select_for_team_member" ON public.scrape_jobs;
CREATE POLICY "scrape_jobs_select_for_team_member"
ON public.scrape_jobs
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "scrape_job_contributions_select_for_team_member" ON public.scrape_job_contributions;
CREATE POLICY "scrape_job_contributions_select_for_team_member"
ON public.scrape_job_contributions
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "scrape_job_events_select_for_team_member" ON public.scrape_job_events;
CREATE POLICY "scrape_job_events_select_for_team_member"
ON public.scrape_job_events
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "shared_scrapes_select_for_team_member" ON public.shared_scrapes;
CREATE POLICY "shared_scrapes_select_for_team_member"
ON public.shared_scrapes
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "ecosystems_select_for_team_member" ON public.ecosystems;
CREATE POLICY "ecosystems_select_for_team_member"
ON public.ecosystems
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "ecosystem_scrapes_select_for_team_member" ON public.ecosystem_scrapes;
CREATE POLICY "ecosystem_scrapes_select_for_team_member"
ON public.ecosystem_scrapes
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "watched_repos_select_for_team_member" ON public.watched_repos;
CREATE POLICY "watched_repos_select_for_team_member"
ON public.watched_repos
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));

DROP POLICY IF EXISTS "watched_repo_contributors_select_for_team_member" ON public.watched_repo_contributors;
CREATE POLICY "watched_repo_contributors_select_for_team_member"
ON public.watched_repo_contributors
FOR SELECT
TO authenticated
USING (team_id IN (SELECT public.talon_current_user_team_ids()));
