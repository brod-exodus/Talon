-- Verify that Production contains the schema objects Talon depends on instead
-- of trusting the migration ledger alone. Migration 027 intentionally seeded
-- historical versions, so a current version number cannot prove that every
-- older table, column, function, RLS setting, or integrity constraint exists.

SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 42 AND name = 'workspace_referential_integrity'
  ) THEN
    RAISE EXCEPTION 'Talon migration 042 must be applied before migration 043';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_talon_schema_contract_issues()
RETURNS TABLE(requirement_type TEXT, requirement_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH
  required_tables(table_name) AS (
    VALUES
      ('activity_events'),
      ('audit_events'),
      ('auth_rate_limits'),
      ('contributors'),
      ('ecosystem_scrapes'),
      ('ecosystems'),
      ('notification_deliveries'),
      ('project_contributor_tracking'),
      ('project_contributors_cache'),
      ('project_list_contributors'),
      ('project_lists'),
      ('scrape_contributors'),
      ('scrape_enqueue_requests'),
      ('scrape_job_contributions'),
      ('scrape_job_events'),
      ('scrape_job_repository_contributions'),
      ('scrape_jobs'),
      ('scrapes'),
      ('service_cooldowns'),
      ('shared_scrapes'),
      ('system_runs'),
      ('talon_schema_migrations'),
      ('team_memberships'),
      ('teams'),
      ('watched_repo_contributors'),
      ('watched_repos')
  ),
  required_columns(table_name, column_name) AS (
    VALUES
      ('contributors', 'profile_refreshed_at'),
      ('notification_deliveries', 'locked_by'),
      ('scrape_contributors', 'team_id'),
      ('scrape_job_events', 'request_id'),
      ('scrape_jobs', 'request_id'),
      ('scrapes', 'watched_repo_id'),
      ('shared_scrapes', 'token_hash'),
      ('team_memberships', 'app_role'),
      ('team_memberships', 'avatar_url'),
      ('teams', 'owner_email'),
      ('teams', 'workspace_kind'),
      ('watched_repo_contributors', 'detected_scrape_id'),
      ('watched_repos', 'check_status')
  ),
  required_constraints(table_name, constraint_name) AS (
    VALUES
      ('contributors', 'contributors_team_id_id_key'),
      ('ecosystem_scrapes', 'ecosystem_scrapes_team_ecosystem_fkey'),
      ('ecosystem_scrapes', 'ecosystem_scrapes_team_scrape_fkey'),
      ('ecosystems', 'ecosystems_team_id_id_key'),
      ('project_contributor_tracking', 'project_contributor_tracking_team_contributor_fkey'),
      ('project_contributor_tracking', 'project_contributor_tracking_team_ecosystem_fkey'),
      ('project_contributors_cache', 'project_contributors_cache_team_ecosystem_fkey'),
      ('project_list_contributors', 'project_list_contributors_team_contributor_fkey'),
      ('project_list_contributors', 'project_list_contributors_team_list_fkey'),
      ('project_lists', 'project_lists_team_ecosystem_fkey'),
      ('project_lists', 'project_lists_team_id_id_key'),
      ('scrape_contributors', 'scrape_contributors_team_contributor_fkey'),
      ('scrape_contributors', 'scrape_contributors_team_scrape_fkey'),
      ('scrape_enqueue_requests', 'scrape_enqueue_requests_team_job_scrape_fkey'),
      ('scrape_job_contributions', 'scrape_job_contributions_team_job_fkey'),
      ('scrape_job_events', 'scrape_job_events_team_job_fkey'),
      ('scrape_job_events', 'scrape_job_events_team_job_scrape_fkey'),
      ('scrape_job_events', 'scrape_job_events_team_scrape_fkey'),
      ('scrape_job_repository_contributions', 'scrape_job_repository_contributions_team_job_fkey'),
      ('scrape_jobs', 'scrape_jobs_team_id_id_key'),
      ('scrape_jobs', 'scrape_jobs_team_id_id_scrape_id_key'),
      ('scrape_jobs', 'scrape_jobs_team_scrape_fkey'),
      ('scrapes', 'scrapes_team_id_id_key'),
      ('scrapes', 'scrapes_team_watched_repo_fkey'),
      ('shared_scrapes', 'shared_scrapes_team_scrape_fkey'),
      ('watched_repo_contributors', 'watched_repo_contributors_team_detected_scrape_fkey'),
      ('watched_repo_contributors', 'watched_repo_contributors_team_watched_repo_fkey'),
      ('watched_repos', 'watched_repos_team_id_id_key')
  ),
  required_functions(function_signature) AS (
    VALUES
      ('public.checkpoint_organization_contributor_page(uuid,text,text,integer,integer,boolean,jsonb)'),
      ('public.checkpoint_scrape_hydration_batch(uuid,text,jsonb)'),
      ('public.claim_notification_delivery(text)'),
      ('public.claim_scrape_job(text,uuid)'),
      ('public.complete_scrape_job_verified(uuid,text)'),
      ('public.enqueue_due_watched_repo_scrapes(uuid,boolean,uuid)'),
      ('public.enqueue_scrape(uuid,uuid,text,text,text,integer,uuid,uuid)'),
      ('public.get_contactable_scrape_contributors_page(text,integer,integer)'),
      ('public.get_talon_schema_version()'),
      ('public.remove_team_member(uuid,uuid)'),
      ('public.update_team_member_app_role(uuid,uuid,text)')
  ),
  missing_tables AS (
    SELECT 'table'::TEXT AS requirement_type, 'public.' || requirement.table_name AS requirement_name
    FROM required_tables AS requirement
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = requirement.table_name
        AND relation.relkind IN ('r', 'p')
    )
  ),
  missing_columns AS (
    SELECT
      'column'::TEXT,
      'public.' || requirement.table_name || '.' || requirement.column_name
    FROM required_columns AS requirement
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = requirement.table_name
        AND attribute.attname = requirement.column_name
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped
    )
  ),
  missing_constraints AS (
    SELECT
      'constraint'::TEXT,
      'public.' || requirement.table_name || '.' || requirement.constraint_name
    FROM required_constraints AS requirement
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_record
      JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = requirement.table_name
        AND constraint_record.conname = requirement.constraint_name
        AND constraint_record.convalidated
    )
  ),
  missing_functions AS (
    SELECT 'function'::TEXT, requirement.function_signature
    FROM required_functions AS requirement
    WHERE pg_catalog.to_regprocedure(requirement.function_signature) IS NULL
  ),
  missing_rls AS (
    SELECT 'row_level_security'::TEXT, 'public.' || requirement.table_name
    FROM required_tables AS requirement
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = requirement.table_name
        AND relation.relrowsecurity
    )
  )
  SELECT * FROM missing_tables
  UNION ALL SELECT * FROM missing_columns
  UNION ALL SELECT * FROM missing_constraints
  UNION ALL SELECT * FROM missing_functions
  UNION ALL SELECT * FROM missing_rls
  ORDER BY requirement_type, requirement_name;
$$;

DO $$
DECLARE
  first_issue RECORD;
BEGIN
  SELECT * INTO first_issue
  FROM public.get_talon_schema_contract_issues()
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Talon physical schema contract is incomplete: % %',
      first_issue.requirement_type,
      first_issue.requirement_name;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.get_talon_schema_contract_issues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_talon_schema_contract_issues() TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (43, 'schema_contract_attestation')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
