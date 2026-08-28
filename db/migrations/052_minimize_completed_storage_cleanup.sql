-- Remove deleted profile-photo paths as soon as durable cleanup succeeds while
-- preserving them for queued and failed work that still needs recovery.
SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.talon_schema_migrations
    WHERE version = 51 AND name = 'durable_workspace_storage_cleanup'
  ) THEN
    RAISE EXCEPTION 'Talon migration 051 must be applied before migration 052';
  END IF;
END $$;

UPDATE public.storage_cleanup_tasks
SET object_paths = '[]'::JSONB,
    updated_at = NOW()
WHERE status = 'succeeded'
  AND object_paths <> '[]'::JSONB;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.storage_cleanup_tasks
    WHERE status <> 'succeeded'
      AND jsonb_array_length(object_paths) = 0
  ) THEN
    RAISE EXCEPTION 'Talon storage cleanup contains retryable work without object paths';
  END IF;
END $$;

ALTER TABLE public.storage_cleanup_tasks
  ADD CONSTRAINT storage_cleanup_terminal_paths_scrubbed CHECK (
    (status = 'succeeded' AND object_paths = '[]'::JSONB)
    OR (status <> 'succeeded' AND jsonb_array_length(object_paths) > 0)
  ) NOT VALID;

ALTER TABLE public.storage_cleanup_tasks
  VALIDATE CONSTRAINT storage_cleanup_terminal_paths_scrubbed;

CREATE OR REPLACE FUNCTION public.complete_storage_cleanup_task(p_task_id UUID, p_worker_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE public.storage_cleanup_tasks
  SET status = 'succeeded',
      object_paths = '[]'::JSONB,
      locked_by = NULL,
      locked_at = NULL,
      last_error = NULL,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_task_id
    AND status = 'running'
    AND locked_by = p_worker_id;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_storage_cleanup_task(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_storage_cleanup_task(UUID, TEXT)
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
    ('public.recover_stale_storage_cleanup_tasks(timestamp with time zone)'::TEXT)
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
VALUES (52, 'minimize_completed_storage_cleanup')
ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;
