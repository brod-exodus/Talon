-- Protect in-flight cursor and progress writes with the same worker lease used
-- by claim, yield, failure, and completion transitions.

CREATE OR REPLACE FUNCTION public.checkpoint_scrape_job(
  p_job_id UUID,
  p_worker_id TEXT,
  p_state JSONB DEFAULT NULL,
  p_progress INTEGER DEFAULT NULL,
  p_current INTEGER DEFAULT NULL,
  p_total INTEGER DEFAULT NULL,
  p_current_user_login TEXT DEFAULT NULL
)
RETURNS TABLE(applied BOOLEAN, result_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.scrape_jobs%ROWTYPE;
BEGIN
  IF p_worker_id IS NULL OR BTRIM(p_worker_id) = '' THEN
    RAISE EXCEPTION 'Worker id is required' USING ERRCODE = '22023';
  END IF;

  IF p_state IS NULL AND p_progress IS NULL THEN
    RAISE EXCEPTION 'Checkpoint must include state or progress' USING ERRCODE = '22023';
  END IF;

  IF p_state IS NOT NULL AND JSONB_TYPEOF(p_state) <> 'object' THEN
    RAISE EXCEPTION 'Checkpoint state must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF p_progress IS NOT NULL AND (
    p_current IS NULL
    OR p_total IS NULL
    OR p_progress < 0
    OR p_progress > 99
    OR p_current < 0
    OR p_total < 0
    OR p_current > p_total
  ) THEN
    RAISE EXCEPTION 'Checkpoint progress is invalid' USING ERRCODE = '22023';
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
    RETURN QUERY SELECT FALSE, CASE
      WHEN current_job.cancel_requested THEN 'canceled'::TEXT
      ELSE current_job.status
    END;
    RETURN;
  END IF;

  UPDATE public.scrape_jobs
  SET state = COALESCE(p_state, state),
      updated_at = NOW()
  WHERE id = current_job.id;

  IF p_progress IS NOT NULL THEN
    UPDATE public.scrapes
    SET progress = p_progress,
        current = p_current,
        total = p_total,
        current_user_login = p_current_user_login
    WHERE id = current_job.scrape_id
      AND team_id = current_job.team_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Scrape not found for job' USING ERRCODE = '23503';
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, 'running'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.checkpoint_scrape_job(UUID, TEXT, JSONB, INTEGER, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkpoint_scrape_job(UUID, TEXT, JSONB, INTEGER, INTEGER, INTEGER, TEXT) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (32, 'lease_safe_job_checkpoints')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
