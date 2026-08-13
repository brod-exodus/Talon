-- Persist one safe correlation identifier across request, audit, queue, worker,
-- and operational-run records. Existing rows remain valid with NULL IDs.

ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS request_id UUID;

ALTER TABLE public.system_runs
  ADD COLUMN IF NOT EXISTS request_id UUID;

ALTER TABLE public.scrape_jobs
  ADD COLUMN IF NOT EXISTS request_id UUID;

ALTER TABLE public.scrape_job_events
  ADD COLUMN IF NOT EXISTS request_id UUID;

ALTER TABLE public.scrape_enqueue_requests
  ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE INDEX IF NOT EXISTS idx_audit_events_request_id
  ON public.audit_events(request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_system_runs_request_id
  ON public.system_runs(request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_request_id
  ON public.scrape_jobs(request_id)
  WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scrape_job_events_request_id
  ON public.scrape_job_events(request_id)
  WHERE request_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.enqueue_scrape(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID);

CREATE FUNCTION public.enqueue_scrape(
  p_team_id UUID,
  p_idempotency_key UUID,
  p_scrape_id TEXT,
  p_type TEXT,
  p_target TEXT,
  p_min_contributions INTEGER,
  p_project_id UUID DEFAULT NULL,
  p_request_id UUID DEFAULT NULL
)
RETURNS TABLE(scrape_id TEXT, job_id UUID, replayed BOOLEAN, origin_request_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_request public.scrape_enqueue_requests%ROWTYPE;
  new_job_id UUID;
BEGIN
  IF p_type NOT IN ('organization', 'repository') THEN
    RAISE EXCEPTION 'Invalid scrape type' USING ERRCODE = '22023';
  END IF;
  IF p_target IS NULL OR BTRIM(p_target) = '' THEN
    RAISE EXCEPTION 'Invalid scrape target' USING ERRCODE = '22023';
  END IF;
  IF p_min_contributions IS NULL OR p_min_contributions < 1 THEN
    RAISE EXCEPTION 'Invalid minimum contributions' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(p_team_id::TEXT),
    hashtext(p_idempotency_key::TEXT)
  );

  SELECT request.*
  INTO existing_request
  FROM public.scrape_enqueue_requests AS request
  WHERE request.team_id = p_team_id
    AND request.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF existing_request.scrape_type IS DISTINCT FROM p_type
      OR existing_request.target IS DISTINCT FROM p_target
      OR existing_request.min_contributions IS DISTINCT FROM p_min_contributions
      OR existing_request.project_id IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different scrape request'
        USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT existing_request.scrape_id, existing_request.job_id, TRUE, existing_request.request_id;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = p_team_id) THEN
    RAISE EXCEPTION 'Team not found' USING ERRCODE = '23503';
  END IF;

  IF p_project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.ecosystems
    WHERE id = p_project_id
      AND team_id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Project not found' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.scrapes (
    id,
    team_id,
    type,
    target,
    status,
    progress,
    current,
    total,
    current_user_login,
    started_at,
    completed_at,
    error,
    min_contributions
  ) VALUES (
    p_scrape_id,
    p_team_id,
    p_type,
    p_target,
    'active',
    0,
    0,
    0,
    NULL,
    NOW(),
    NULL,
    NULL,
    p_min_contributions
  );

  INSERT INTO public.scrape_jobs (
    scrape_id,
    team_id,
    type,
    target,
    min_contributions,
    status,
    run_after,
    state,
    cancel_requested,
    request_id
  ) VALUES (
    p_scrape_id,
    p_team_id,
    p_type,
    p_target,
    p_min_contributions,
    'queued',
    NOW(),
    '{}'::JSONB,
    FALSE,
    p_request_id
  )
  RETURNING id INTO new_job_id;

  IF p_project_id IS NOT NULL THEN
    INSERT INTO public.ecosystem_scrapes (ecosystem_id, scrape_id, team_id)
    VALUES (p_project_id, p_scrape_id, p_team_id);
  END IF;

  INSERT INTO public.scrape_job_events (
    team_id,
    job_id,
    scrape_id,
    event_type,
    message,
    metadata,
    request_id
  ) VALUES (
    p_team_id,
    new_job_id,
    p_scrape_id,
    'queued',
    FORMAT('Queued %s scrape for %s', p_type, p_target),
    jsonb_build_object(
      'type', p_type,
      'target', p_target,
      'minContributions', p_min_contributions
    ),
    p_request_id
  );

  INSERT INTO public.scrape_enqueue_requests (
    team_id,
    idempotency_key,
    scrape_id,
    job_id,
    scrape_type,
    target,
    min_contributions,
    project_id,
    request_id
  ) VALUES (
    p_team_id,
    p_idempotency_key,
    p_scrape_id,
    new_job_id,
    p_type,
    p_target,
    p_min_contributions,
    p_project_id,
    p_request_id
  );

  RETURN QUERY SELECT p_scrape_id, new_job_id, FALSE, p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_scrape(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_scrape(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID, UUID) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (29, 'operation_correlation')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
