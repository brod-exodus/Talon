-- Make Talon's security and scrape execution ledgers append-only to the
-- application role. Controlled retention still runs through the existing
-- SECURITY DEFINER cleanup function, whose owner retains delete authority.

SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 43 AND name = 'schema_contract_attestation'
  ) THEN
    RAISE EXCEPTION 'Talon migration 043 must be applied before migration 044';
  END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public.audit_events, public.scrape_job_events
  FROM PUBLIC, anon, authenticated;

REVOKE UPDATE, DELETE, TRUNCATE
  ON TABLE public.audit_events, public.scrape_job_events
  FROM service_role;

GRANT SELECT, INSERT
  ON TABLE public.audit_events, public.scrape_job_events
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_talon_append_only_contract_issues()
RETURNS TABLE(requirement_type TEXT, requirement_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH required_table_privileges(
    role_name,
    relation_name,
    privilege_name,
    should_have_privilege
  ) AS (
    VALUES
      ('service_role', 'public.audit_events', 'SELECT', TRUE),
      ('service_role', 'public.audit_events', 'INSERT', TRUE),
      ('service_role', 'public.audit_events', 'UPDATE', FALSE),
      ('service_role', 'public.audit_events', 'DELETE', FALSE),
      ('service_role', 'public.audit_events', 'TRUNCATE', FALSE),
      ('service_role', 'public.scrape_job_events', 'SELECT', TRUE),
      ('service_role', 'public.scrape_job_events', 'INSERT', TRUE),
      ('service_role', 'public.scrape_job_events', 'UPDATE', FALSE),
      ('service_role', 'public.scrape_job_events', 'DELETE', FALSE),
      ('service_role', 'public.scrape_job_events', 'TRUNCATE', FALSE),
      ('anon', 'public.audit_events', 'INSERT', FALSE),
      ('anon', 'public.audit_events', 'UPDATE', FALSE),
      ('anon', 'public.audit_events', 'DELETE', FALSE),
      ('authenticated', 'public.audit_events', 'INSERT', FALSE),
      ('authenticated', 'public.audit_events', 'UPDATE', FALSE),
      ('authenticated', 'public.audit_events', 'DELETE', FALSE),
      ('anon', 'public.scrape_job_events', 'INSERT', FALSE),
      ('anon', 'public.scrape_job_events', 'UPDATE', FALSE),
      ('anon', 'public.scrape_job_events', 'DELETE', FALSE),
      ('authenticated', 'public.scrape_job_events', 'INSERT', FALSE),
      ('authenticated', 'public.scrape_job_events', 'UPDATE', FALSE),
      ('authenticated', 'public.scrape_job_events', 'DELETE', FALSE)
  ),
  table_issues AS (
    SELECT
      'table_privilege'::TEXT AS requirement_type,
      pg_catalog.format(
        '%s %s on %s must be %s',
        requirement.role_name,
        requirement.privilege_name,
        requirement.relation_name,
        CASE WHEN requirement.should_have_privilege THEN 'granted' ELSE 'denied' END
      )::TEXT AS requirement_name
    FROM required_table_privileges AS requirement
    WHERE pg_catalog.has_table_privilege(
      requirement.role_name,
      requirement.relation_name,
      requirement.privilege_name
    ) IS DISTINCT FROM requirement.should_have_privilege
  ),
  function_issues AS (
    SELECT
      'function_privilege'::TEXT AS requirement_type,
      'service_role EXECUTE on public.cleanup_talon_retention() must be granted'::TEXT AS requirement_name
    WHERE NOT pg_catalog.has_function_privilege(
      'service_role',
      'public.cleanup_talon_retention()',
      'EXECUTE'
    )
  )
  SELECT * FROM table_issues
  UNION ALL
  SELECT * FROM function_issues
  ORDER BY requirement_type, requirement_name;
$$;

REVOKE ALL ON FUNCTION public.get_talon_append_only_contract_issues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_talon_append_only_contract_issues() TO service_role;

DO $$
DECLARE
  first_issue RECORD;
BEGIN
  SELECT * INTO first_issue
  FROM public.get_talon_append_only_contract_issues()
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Talon append-only contract is incomplete: % %',
      first_issue.requirement_type,
      first_issue.requirement_name;
  END IF;
END $$;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (44, 'append_only_operational_history')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
