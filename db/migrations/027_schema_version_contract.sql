-- Establish an application-visible schema contract. Migration 026 is required
-- first because the ledger certifies the complete Talon schema through v27.

DO $$
BEGIN
  IF to_regclass('public.scrapes') IS NULL
    OR to_regclass('public.contributors') IS NULL
    OR to_regclass('public.scrape_jobs') IS NULL
    OR to_regclass('public.scrape_job_contributions') IS NULL
    OR to_regclass('public.scrape_job_events') IS NULL
    OR to_regclass('public.shared_scrapes') IS NULL
    OR to_regclass('public.teams') IS NULL
    OR to_regclass('public.team_memberships') IS NULL
    OR to_regclass('public.audit_events') IS NULL
    OR to_regclass('public.auth_rate_limits') IS NULL
    OR to_regclass('public.activity_events') IS NULL
    OR to_regclass('public.project_contributors_cache') IS NULL
    OR to_regclass('public.project_lists') IS NULL
    OR to_regclass('public.project_contributor_tracking') IS NULL
    OR to_regclass('public.system_runs') IS NULL
    OR to_regprocedure('public.talon_current_user_team_ids()') IS NULL
    OR to_regprocedure('public.get_contactable_scrape_contributors_page(text,integer,integer)') IS NULL
    OR to_regprocedure('public.cleanup_talon_retention()') IS NULL THEN
    RAISE EXCEPTION 'Talon migration 026 must be applied before migration 027';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.talon_schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.talon_schema_migrations (version, name)
VALUES
  (1, 'initial_schema'),
  (2, 'scrape_jobs'),
  (3, 'scrape_job_resume_cancel'),
  (4, 'scrape_job_contributions'),
  (5, 'scrape_contributors_page_rpc'),
  (6, 'scrape_job_events'),
  (7, 'security_events'),
  (8, 'team_foundation'),
  (9, 'team_unique_constraints'),
  (10, 'service_role_rls_lockdown'),
  (11, 'team_user_auth'),
  (12, 'team_profile_photos'),
  (13, 'project_contributors_cache'),
  (14, 'contributor_profiles'),
  (15, 'activity_events'),
  (16, 'project_lists'),
  (17, 'project_contributor_tracking'),
  (18, 'private_workspaces'),
  (19, 'team_membership_app_roles'),
  (20, 'search_trigram_indexes'),
  (21, 'database_join_indexes'),
  (22, 'talon_score'),
  (23, 'remove_talon_score'),
  (24, 'system_runs'),
  (25, 'contactable_scrape_contributors_rpc'),
  (26, 'share_lifecycle_and_retention'),
  (27, 'schema_version_contract')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;

ALTER TABLE public.talon_schema_migrations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.talon_schema_migrations FROM anon, authenticated;
GRANT ALL ON TABLE public.talon_schema_migrations TO service_role;

CREATE OR REPLACE FUNCTION public.get_talon_schema_version()
RETURNS INTEGER
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(MAX(version), 0)::INTEGER
  FROM public.talon_schema_migrations;
$$;

REVOKE ALL ON FUNCTION public.get_talon_schema_version() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_talon_schema_version() TO service_role;
