-- Persist profile-photo cleanup before a workspace is deleted so failures can
-- be retried by overlapping serverless workers without exposing object paths.
SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.talon_schema_migrations WHERE version = 50 AND name = 'transactional_workspace_deletion') THEN
    RAISE EXCEPTION 'Talon migration 050 must be applied before migration 051';
  END IF;
END $$;

CREATE TABLE public.storage_cleanup_tasks (
  id UUID PRIMARY KEY,
  bucket TEXT NOT NULL CHECK (bucket = 'team-avatars'),
  object_paths JSONB NOT NULL CHECK (jsonb_typeof(object_paths) = 'array'),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  last_error TEXT CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT storage_cleanup_task_lock_consistent CHECK (
    (status = 'running' AND locked_by IS NOT NULL AND locked_at IS NOT NULL)
    OR (status <> 'running' AND locked_by IS NULL AND locked_at IS NULL)
  )
);
CREATE INDEX idx_storage_cleanup_tasks_due ON public.storage_cleanup_tasks(status, run_after, created_at);
ALTER TABLE public.storage_cleanup_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.storage_cleanup_tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.storage_cleanup_tasks TO service_role;

CREATE OR REPLACE FUNCTION public.claim_storage_cleanup_task(p_worker_id TEXT, p_task_id UUID DEFAULT NULL)
RETURNS SETOF public.storage_cleanup_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT id FROM public.storage_cleanup_tasks
    WHERE status = 'queued' AND run_after <= NOW() AND (p_task_id IS NULL OR id = p_task_id)
    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE public.storage_cleanup_tasks task SET
    status = 'running', attempts = task.attempts + 1,
    locked_by = p_worker_id, locked_at = NOW(), updated_at = NOW()
  FROM candidate WHERE task.id = candidate.id RETURNING task.*;
END $$;

CREATE OR REPLACE FUNCTION public.complete_storage_cleanup_task(p_task_id UUID, p_worker_id TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE affected INTEGER;
BEGIN
  UPDATE public.storage_cleanup_tasks SET status='succeeded', locked_by=NULL, locked_at=NULL,
    last_error=NULL, completed_at=NOW(), updated_at=NOW()
  WHERE id=p_task_id AND status='running' AND locked_by=p_worker_id;
  GET DIAGNOSTICS affected = ROW_COUNT; RETURN affected = 1;
END $$;

CREATE OR REPLACE FUNCTION public.fail_storage_cleanup_task(p_task_id UUID, p_worker_id TEXT, p_error TEXT)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE next_status TEXT;
BEGIN
  UPDATE public.storage_cleanup_tasks SET
    status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
    run_after = CASE WHEN attempts >= max_attempts THEN run_after ELSE NOW() + make_interval(secs => LEAST(900, 30 * power(2, GREATEST(0, attempts - 1)))::INTEGER) END,
    locked_by=NULL, locked_at=NULL, last_error=left(p_error,500), updated_at=NOW(),
    completed_at=CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END
  WHERE id=p_task_id AND status='running' AND locked_by=p_worker_id
  RETURNING status INTO next_status;
  RETURN next_status;
END $$;

CREATE OR REPLACE FUNCTION public.recover_stale_storage_cleanup_tasks(p_stale_before TIMESTAMPTZ)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE recovered INTEGER;
BEGIN
  UPDATE public.storage_cleanup_tasks SET status='queued', run_after=NOW(), locked_by=NULL,
    locked_at=NULL, last_error='Recovered stale cleanup lease', updated_at=NOW()
  WHERE status='running' AND locked_at < p_stale_before;
  GET DIAGNOSTICS recovered = ROW_COUNT; RETURN recovered;
END $$;

REVOKE ALL ON FUNCTION public.claim_storage_cleanup_task(TEXT, UUID), public.complete_storage_cleanup_task(UUID, TEXT), public.fail_storage_cleanup_task(UUID, TEXT, TEXT), public.recover_stale_storage_cleanup_tasks(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_storage_cleanup_task(TEXT, UUID), public.complete_storage_cleanup_task(UUID, TEXT), public.fail_storage_cleanup_task(UUID, TEXT, TEXT), public.recover_stale_storage_cleanup_tasks(TIMESTAMPTZ) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_workspace_data(p_team_id UUID, p_confirmation TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE workspace RECORD; receipt_id UUID := gen_random_uuid(); deleted_at TIMESTAMPTZ := NOW(); avatar_paths JSONB;
BEGIN
  SELECT id,slug INTO workspace FROM public.teams WHERE id=p_team_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workspace not found' USING ERRCODE='23503'; END IF;
  IF p_confirmation IS DISTINCT FROM workspace.slug THEN RAISE EXCEPTION 'Workspace confirmation did not match' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.scrape_jobs WHERE team_id=p_team_id AND status IN ('queued','running'))
    OR EXISTS (SELECT 1 FROM public.notification_deliveries WHERE team_id=p_team_id AND status IN ('queued','running'))
    OR EXISTS (SELECT 1 FROM public.scrapes WHERE team_id=p_team_id AND status='active')
  THEN RAISE EXCEPTION 'Workspace has active work' USING ERRCODE='55006'; END IF;
  SELECT COALESCE(jsonb_agg(avatar_path ORDER BY avatar_path),'[]'::jsonb) INTO avatar_paths
    FROM public.team_memberships WHERE team_id=p_team_id AND avatar_path IS NOT NULL;
  IF jsonb_array_length(avatar_paths) > 0 THEN
    INSERT INTO public.storage_cleanup_tasks(id,bucket,object_paths) VALUES(receipt_id,'team-avatars',avatar_paths);
  END IF;
  DELETE FROM public.audit_events WHERE team_id=p_team_id;
  DELETE FROM public.teams WHERE id=p_team_id;
  INSERT INTO public.audit_events(id,action,outcome,actor,metadata,created_at)
    VALUES(receipt_id,'workspace.delete','success','user',jsonb_build_object('receiptVersion',1,'deletedAt',deleted_at),deleted_at);
  RETURN jsonb_build_object('version',1,'receiptId',receipt_id,'deletedAt',deleted_at,'hasStorageCleanup',jsonb_array_length(avatar_paths)>0);
END $$;

CREATE OR REPLACE FUNCTION public.get_talon_lifecycle_contract_issues()
RETURNS TABLE(requirement_type TEXT, requirement_name TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  WITH required_functions(signature) AS (VALUES
    ('public.preview_workspace_lifecycle(uuid)'::TEXT), ('public.export_workspace_data(uuid)'::TEXT),
    ('public.delete_workspace_data(uuid,text)'::TEXT), ('public.claim_storage_cleanup_task(text,uuid)'::TEXT),
    ('public.complete_storage_cleanup_task(uuid,text)'::TEXT), ('public.fail_storage_cleanup_task(uuid,text,text)'::TEXT),
    ('public.recover_stale_storage_cleanup_tasks(timestamp with time zone)'::TEXT)
  ), roles(role_name,allowed) AS (VALUES('service_role',TRUE),('anon',FALSE),('authenticated',FALSE))
  SELECT 'table'::TEXT,'public.storage_cleanup_tasks'::TEXT WHERE to_regclass('public.storage_cleanup_tasks') IS NULL
  UNION ALL SELECT 'function',signature FROM required_functions WHERE to_regprocedure(signature) IS NULL
  UNION ALL SELECT 'function_privilege',format('%s EXECUTE on %s must be %s',role_name,signature,allowed)
    FROM required_functions CROSS JOIN roles WHERE to_regprocedure(signature) IS NOT NULL
      AND has_function_privilege(role_name,signature,'EXECUTE') IS DISTINCT FROM allowed
  ORDER BY 1,2;
$$;
REVOKE ALL ON FUNCTION public.get_talon_lifecycle_contract_issues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_talon_lifecycle_contract_issues() TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (51, 'durable_workspace_storage_cleanup')
ON CONFLICT(version) DO UPDATE SET name=EXCLUDED.name;
