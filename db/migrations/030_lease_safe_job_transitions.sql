-- Make worker-owned state transitions atomic. A canceled job, recovered stale
-- lock, or newer worker lease must never be overwritten by an older worker.

CREATE OR REPLACE FUNCTION public.yield_scrape_job(
  p_job_id UUID,
  p_worker_id TEXT
)
RETURNS TABLE(applied BOOLEAN, result_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.scrape_jobs%ROWTYPE;
BEGIN
  SELECT * INTO current_job
  FROM public.scrape_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scrape job not found' USING ERRCODE = '23503';
  END IF;

  IF current_job.status <> 'running'
    OR current_job.locked_by IS DISTINCT FROM p_worker_id
    OR current_job.cancel_requested THEN
    RETURN QUERY SELECT FALSE, current_job.status;
    RETURN;
  END IF;

  UPDATE public.scrape_jobs
  SET status = 'queued',
      attempts = 0,
      run_after = NOW(),
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      updated_at = NOW()
  WHERE id = current_job.id;

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    current_job.team_id,
    current_job.id,
    current_job.scrape_id,
    'step_completed',
    'Scrape step completed; job requeued',
    jsonb_build_object('workerId', p_worker_id),
    current_job.request_id
  );

  RETURN QUERY SELECT TRUE, 'queued'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_scrape_job_step(
  p_job_id UUID,
  p_worker_id TEXT,
  p_next_status TEXT,
  p_run_after TIMESTAMPTZ,
  p_error TEXT,
  p_retry_delay_ms BIGINT
)
RETURNS TABLE(applied BOOLEAN, result_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.scrape_jobs%ROWTYPE;
BEGIN
  IF p_next_status IS NULL OR p_next_status NOT IN ('queued', 'failed') THEN
    RAISE EXCEPTION 'Invalid failure transition' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_job
  FROM public.scrape_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scrape job not found' USING ERRCODE = '23503';
  END IF;

  IF current_job.status <> 'running'
    OR current_job.locked_by IS DISTINCT FROM p_worker_id
    OR current_job.cancel_requested THEN
    RETURN QUERY SELECT FALSE, current_job.status;
    RETURN;
  END IF;

  UPDATE public.scrape_jobs
  SET status = p_next_status,
      run_after = CASE WHEN p_next_status = 'queued' THEN COALESCE(p_run_after, NOW()) ELSE run_after END,
      locked_at = NULL,
      locked_by = NULL,
      last_error = p_error,
      updated_at = NOW()
  WHERE id = current_job.id;

  IF p_next_status = 'failed' THEN
    UPDATE public.scrapes
    SET status = 'failed',
        completed_at = NOW(),
        error = p_error,
        current_user_login = NULL
    WHERE id = current_job.scrape_id
      AND team_id = current_job.team_id;
  END IF;

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    current_job.team_id,
    current_job.id,
    current_job.scrape_id,
    CASE WHEN p_next_status = 'failed' THEN 'failed' ELSE 'retry_scheduled' END,
    p_error,
    jsonb_build_object(
      'nextRun', CASE WHEN p_next_status = 'failed' THEN NULL ELSE p_run_after END,
      'retryDelayMs', p_retry_delay_ms,
      'attempt', current_job.attempts,
      'maxAttempts', current_job.max_attempts,
      'workerId', p_worker_id
    ),
    current_job.request_id
  );

  RETURN QUERY SELECT TRUE, p_next_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_scrape_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_contributor_total INTEGER,
  p_contact_info_count INTEGER
)
RETURNS TABLE(applied BOOLEAN, result_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.scrape_jobs%ROWTYPE;
BEGIN
  IF p_contributor_total IS NULL OR p_contact_info_count IS NULL
    OR p_contributor_total < 0 OR p_contact_info_count < 0 THEN
    RAISE EXCEPTION 'Contributor totals cannot be negative' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_job
  FROM public.scrape_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scrape job not found' USING ERRCODE = '23503';
  END IF;

  IF current_job.status <> 'running'
    OR current_job.locked_by IS DISTINCT FROM p_worker_id
    OR current_job.cancel_requested THEN
    RETURN QUERY SELECT FALSE, current_job.status;
    RETURN;
  END IF;

  UPDATE public.scrapes
  SET status = 'completed',
      progress = 100,
      completed_at = NOW(),
      error = NULL,
      current_user_login = NULL,
      contact_info_count = p_contact_info_count,
      total_contributors = p_contributor_total
  WHERE id = current_job.scrape_id
    AND team_id = current_job.team_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scrape not found for job' USING ERRCODE = '23503';
  END IF;

  UPDATE public.scrape_jobs
  SET status = 'succeeded',
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      cancel_requested = FALSE,
      updated_at = NOW()
  WHERE id = current_job.id;

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    current_job.team_id,
    current_job.id,
    current_job.scrape_id,
    'succeeded',
    'Scrape job succeeded',
    jsonb_build_object(
      'workerId', p_worker_id,
      'contributorTotal', p_contributor_total,
      'contactInfoCount', p_contact_info_count
    ),
    current_job.request_id
  );

  RETURN QUERY SELECT TRUE, 'succeeded'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_scrape_job(
  p_job_id UUID,
  p_team_id UUID,
  p_reason TEXT
)
RETURNS TABLE(applied BOOLEAN, result_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.scrape_jobs%ROWTYPE;
BEGIN
  SELECT * INTO current_job
  FROM public.scrape_jobs
  WHERE id = p_job_id
    AND (p_team_id IS NULL OR team_id = p_team_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scrape job not found' USING ERRCODE = '23503';
  END IF;

  IF current_job.status = 'succeeded' THEN
    RETURN QUERY SELECT FALSE, current_job.status;
    RETURN;
  END IF;

  UPDATE public.scrape_jobs
  SET status = 'canceled',
      cancel_requested = TRUE,
      locked_at = NULL,
      locked_by = NULL,
      last_error = p_reason,
      updated_at = NOW()
  WHERE id = current_job.id;

  UPDATE public.scrapes
  SET status = 'canceled',
      completed_at = NOW(),
      error = p_reason,
      current_user_login = NULL
  WHERE id = current_job.scrape_id
    AND team_id = current_job.team_id;

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    current_job.team_id,
    current_job.id,
    current_job.scrape_id,
    'canceled',
    p_reason,
    '{}'::JSONB,
    current_job.request_id
  );

  RETURN QUERY SELECT TRUE, 'canceled'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_scrape_job(
  p_job_id UUID,
  p_team_id UUID
)
RETURNS TABLE(applied BOOLEAN, result_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.scrape_jobs%ROWTYPE;
BEGIN
  SELECT * INTO current_job
  FROM public.scrape_jobs
  WHERE id = p_job_id
    AND (p_team_id IS NULL OR team_id = p_team_id)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scrape job not found' USING ERRCODE = '23503';
  END IF;

  IF current_job.status NOT IN ('failed', 'canceled', 'queued') THEN
    RETURN QUERY SELECT FALSE, current_job.status;
    RETURN;
  END IF;

  UPDATE public.scrape_jobs
  SET status = 'queued',
      attempts = 0,
      run_after = NOW(),
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      cancel_requested = FALSE,
      updated_at = NOW()
  WHERE id = current_job.id;

  UPDATE public.scrapes
  SET status = 'active',
      progress = 0,
      current = 0,
      total = 0,
      current_user_login = NULL,
      completed_at = NULL,
      error = NULL
  WHERE id = current_job.scrape_id
    AND team_id = current_job.team_id;

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    current_job.team_id,
    current_job.id,
    current_job.scrape_id,
    'retried',
    'Scrape job was manually requeued',
    '{}'::JSONB,
    current_job.request_id
  );

  RETURN QUERY SELECT TRUE, 'queued'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.recover_stale_scrape_job(
  p_job_id UUID,
  p_expected_worker_id TEXT,
  p_cutoff TIMESTAMPTZ,
  p_next_status TEXT,
  p_error TEXT
)
RETURNS TABLE(applied BOOLEAN, result_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.scrape_jobs%ROWTYPE;
  recovery_status TEXT;
BEGIN
  IF p_next_status IS NULL OR p_next_status NOT IN ('queued', 'failed', 'canceled') THEN
    RAISE EXCEPTION 'Invalid stale recovery transition' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_job
  FROM public.scrape_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scrape job not found' USING ERRCODE = '23503';
  END IF;

  IF current_job.status <> 'running'
    OR current_job.locked_by IS DISTINCT FROM p_expected_worker_id
    OR current_job.locked_at IS NULL
    OR current_job.locked_at >= p_cutoff THEN
    RETURN QUERY SELECT FALSE, current_job.status;
    RETURN;
  END IF;

  recovery_status := CASE WHEN current_job.cancel_requested THEN 'canceled' ELSE p_next_status END;

  UPDATE public.scrape_jobs
  SET status = recovery_status,
      run_after = CASE WHEN recovery_status = 'queued' THEN NOW() ELSE run_after END,
      locked_at = NULL,
      locked_by = NULL,
      last_error = p_error,
      cancel_requested = recovery_status = 'canceled',
      updated_at = NOW()
  WHERE id = current_job.id;

  IF recovery_status IN ('failed', 'canceled') THEN
    UPDATE public.scrapes
    SET status = recovery_status,
        completed_at = NOW(),
        error = p_error,
        current_user_login = NULL
    WHERE id = current_job.scrape_id
      AND team_id = current_job.team_id;
  END IF;

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    current_job.team_id,
    current_job.id,
    current_job.scrape_id,
    CASE
      WHEN recovery_status = 'failed' THEN 'failed'
      WHEN recovery_status = 'canceled' THEN 'canceled'
      ELSE 'stale_lock_recovered'
    END,
    p_error,
    jsonb_build_object(
      'previousWorkerId', current_job.locked_by,
      'previousLockedAt', current_job.locked_at,
      'attempt', current_job.attempts,
      'maxAttempts', current_job.max_attempts
    ),
    current_job.request_id
  );

  RETURN QUERY SELECT TRUE, recovery_status;
END;
$$;

REVOKE ALL ON FUNCTION public.yield_scrape_job(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_scrape_job_step(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_scrape_job(UUID, TEXT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_scrape_job(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retry_scrape_job(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_stale_scrape_job(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.yield_scrape_job(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_scrape_job_step(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_scrape_job(UUID, TEXT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_scrape_job(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_scrape_job(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_stale_scrape_job(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (30, 'lease_safe_job_transitions')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
