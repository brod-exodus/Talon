-- Claim exactly one due scrape job without making competing workers inspect or
-- contend for the same small candidate set.

CREATE INDEX IF NOT EXISTS idx_scrape_jobs_team_due_queue
  ON public.scrape_jobs(team_id, run_after, created_at)
  WHERE status = 'queued' AND cancel_requested = FALSE;

CREATE OR REPLACE FUNCTION public.claim_scrape_job(
  p_worker_id TEXT,
  p_team_id UUID DEFAULT NULL
)
RETURNS SETOF public.scrape_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_job public.scrape_jobs%ROWTYPE;
BEGIN
  IF p_worker_id IS NULL OR BTRIM(p_worker_id) = '' THEN
    RAISE EXCEPTION 'Worker id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO claimed_job
  FROM public.scrape_jobs
  WHERE status = 'queued'
    AND cancel_requested = FALSE
    AND run_after <= NOW()
    AND (p_team_id IS NULL OR team_id = p_team_id)
  ORDER BY run_after ASC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.scrape_jobs
  SET status = 'running',
      attempts = claimed_job.attempts + 1,
      locked_at = NOW(),
      locked_by = p_worker_id,
      updated_at = NOW()
  WHERE id = claimed_job.id
  RETURNING * INTO claimed_job;

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    claimed_job.team_id,
    claimed_job.id,
    claimed_job.scrape_id,
    'claimed',
    'Worker claimed scrape job',
    jsonb_build_object(
      'workerId', p_worker_id,
      'attempt', claimed_job.attempts
    ),
    claimed_job.request_id
  );

  RETURN NEXT claimed_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scrape_job(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_scrape_job(TEXT, UUID) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (31, 'atomic_job_claim')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
