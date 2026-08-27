-- Delete one workspace and all of its Postgres-owned data in one transaction.
-- The function is service-role only, locks the workspace root, refuses active
-- work, removes workspace-linked audit history, and preserves one anonymous
-- terminal receipt after the team row is gone.

SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.talon_schema_migrations
    WHERE version = 49 AND name = 'workspace_data_export'
  ) THEN
    RAISE EXCEPTION 'Talon migration 049 must be applied before migration 050';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.delete_workspace_data(
  p_team_id UUID,
  p_confirmation TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  workspace RECORD;
  receipt_id UUID := gen_random_uuid();
  deleted_at TIMESTAMPTZ := NOW();
  avatar_paths JSONB;
BEGIN
  SELECT id, slug INTO workspace
  FROM public.teams
  WHERE id = p_team_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found' USING ERRCODE = '23503';
  END IF;

  IF p_confirmation IS DISTINCT FROM workspace.slug THEN
    RAISE EXCEPTION 'Workspace confirmation did not match' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.scrape_jobs
    WHERE team_id = p_team_id AND status IN ('queued', 'running')
  ) OR EXISTS (
    SELECT 1 FROM public.notification_deliveries
    WHERE team_id = p_team_id AND status IN ('queued', 'running')
  ) OR EXISTS (
    SELECT 1 FROM public.scrapes
    WHERE team_id = p_team_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Workspace has active work' USING ERRCODE = '55006';
  END IF;

  -- Audit history may contain actor or operational metadata. Delete it before
  -- the team FK can turn it into unscoped history, then create one receipt that
  -- contains no workspace identifier, user identifier, or row counts.
  SELECT COALESCE(jsonb_agg(avatar_path ORDER BY avatar_path), '[]'::jsonb)
  INTO avatar_paths
  FROM public.team_memberships
  WHERE team_id = p_team_id AND avatar_path IS NOT NULL;

  DELETE FROM public.audit_events WHERE team_id = p_team_id;
  DELETE FROM public.teams WHERE id = p_team_id;

  INSERT INTO public.audit_events (id, action, outcome, actor, metadata, created_at)
  VALUES (
    receipt_id,
    'workspace.delete',
    'success',
    'user',
    jsonb_build_object('receiptVersion', 1, 'deletedAt', deleted_at),
    deleted_at
  );

  RETURN jsonb_build_object(
    'version', 1,
    'receiptId', receipt_id,
    'deletedAt', deleted_at,
    'avatarPaths', avatar_paths
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_workspace_data(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_workspace_data(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_talon_lifecycle_contract_issues()
RETURNS TABLE(requirement_type TEXT, requirement_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH required_functions(signature) AS (
    VALUES
      ('public.preview_workspace_lifecycle(uuid)'::TEXT),
      ('public.export_workspace_data(uuid)'::TEXT),
      ('public.delete_workspace_data(uuid,text)'::TEXT)
  ), required_roles(role_name, allowed) AS (
    VALUES ('service_role', TRUE), ('anon', FALSE), ('authenticated', FALSE)
  )
  SELECT 'function'::TEXT, required.signature
  FROM required_functions AS required
  WHERE to_regprocedure(required.signature) IS NULL
  UNION ALL
  SELECT
    'function_privilege'::TEXT,
    format('%s EXECUTE on %s must be %s', role.role_name, required.signature, role.allowed)::TEXT
  FROM required_functions AS required
  CROSS JOIN required_roles AS role
  WHERE to_regprocedure(required.signature) IS NOT NULL
    AND has_function_privilege(role.role_name, required.signature, 'EXECUTE') IS DISTINCT FROM role.allowed
  ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.get_talon_lifecycle_contract_issues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_talon_lifecycle_contract_issues() TO service_role;

DO $$
DECLARE first_issue RECORD;
BEGIN
  SELECT * INTO first_issue FROM public.get_talon_lifecycle_contract_issues() LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Talon lifecycle contract is incomplete: % %',
      first_issue.requirement_type, first_issue.requirement_name;
  END IF;
END $$;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (50, 'transactional_workspace_deletion')
ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;
