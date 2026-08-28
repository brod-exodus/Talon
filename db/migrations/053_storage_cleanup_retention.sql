-- Bound path-free successful cleanup evidence while retaining every task that
-- still needs automatic or operator recovery.
SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.talon_schema_migrations
    WHERE version = 52 AND name = 'minimize_completed_storage_cleanup'
  ) THEN
    RAISE EXCEPTION 'Talon migration 052 must be applied before migration 053';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cleanup_storage_cleanup_retention()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  DELETE FROM public.storage_cleanup_tasks
  WHERE status = 'succeeded'
    AND object_paths = '[]'::JSONB
    AND completed_at < NOW() - INTERVAL '90 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_storage_cleanup_retention()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_storage_cleanup_retention()
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_talon_lifecycle_contract_issues()
RETURNS TABLE(requirement_type TEXT, requirement_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH required_functions(signature) AS (VALUES
    ('public.preview_workspace_lifecycle(uuid)'::TEXT),
    ('public.export_workspace_data(uuid)'::TEXT),
    ('public.delete_workspace_data(uuid,text)'::TEXT),
    ('public.claim_storage_cleanup_task(text,uuid)'::TEXT),
    ('public.complete_storage_cleanup_task(uuid,text)'::TEXT),
    ('public.fail_storage_cleanup_task(uuid,text,text)'::TEXT),
    ('public.recover_stale_storage_cleanup_tasks(timestamp with time zone)'::TEXT),
    ('public.cleanup_storage_cleanup_retention()'::TEXT)
  ), roles(role_name, allowed) AS (
    VALUES ('service_role', TRUE), ('anon', FALSE), ('authenticated', FALSE)
  )
  SELECT 'table'::TEXT, 'public.storage_cleanup_tasks'::TEXT
  WHERE to_regclass('public.storage_cleanup_tasks') IS NULL
  UNION ALL
  SELECT 'constraint', 'public.storage_cleanup_tasks.storage_cleanup_terminal_paths_scrubbed'
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    JOIN pg_catalog.pg_class ON pg_class.oid = pg_constraint.conrelid
    JOIN pg_catalog.pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'storage_cleanup_tasks'
      AND pg_constraint.conname = 'storage_cleanup_terminal_paths_scrubbed'
      AND contype = 'c'
      AND convalidated
  )
  UNION ALL
  SELECT 'function', signature
  FROM required_functions
  WHERE to_regprocedure(signature) IS NULL
  UNION ALL
  SELECT 'function_privilege',
    format('%s EXECUTE on %s must be %s', role_name, signature, allowed)
  FROM required_functions
  CROSS JOIN roles
  WHERE to_regprocedure(signature) IS NOT NULL
    AND has_function_privilege(role_name, signature, 'EXECUTE') IS DISTINCT FROM allowed
  ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.get_talon_lifecycle_contract_issues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_talon_lifecycle_contract_issues() TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (53, 'storage_cleanup_retention')
ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;
