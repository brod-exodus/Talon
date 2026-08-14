-- Pause the shared scrape queue when GitHub asks Talon to wait. Without a
-- token-wide cooldown, every due job can consume an attempt against the same
-- exhausted credential before GitHub resets it.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 36 AND name = 'contributor_profile_freshness_cache'
  ) THEN
    RAISE EXCEPTION 'Talon migration 036 must be applied before migration 037';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.service_cooldowns (
  service TEXT PRIMARY KEY CHECK (service = 'github'),
  blocked_until TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN (
    'retry-after',
    'primary-rate-limit',
    'secondary-rate-limit'
  )),
  source_job_id UUID REFERENCES public.scrape_jobs(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.service_cooldowns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_cooldowns FROM anon, authenticated;
GRANT ALL ON TABLE public.service_cooldowns TO service_role;

-- Recreate the atomic claim with a global GitHub cooldown gate. Expired rows
-- are intentionally retained as operational history and stop blocking claims.
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

  IF EXISTS (
    SELECT 1
    FROM public.service_cooldowns
    WHERE service = 'github'
      AND blocked_until > NOW()
  ) THEN
    RETURN;
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

-- Combine failure handling and cooldown activation in one transaction so the
-- queue cannot briefly claim another job between those two state changes.
CREATE OR REPLACE FUNCTION public.fail_scrape_job_step_with_github_cooldown(
  p_job_id UUID,
  p_worker_id TEXT,
  p_next_status TEXT,
  p_run_after TIMESTAMPTZ,
  p_error TEXT,
  p_retry_delay_ms BIGINT,
  p_cooldown_until TIMESTAMPTZ,
  p_cooldown_reason TEXT
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

  IF p_cooldown_until IS NULL OR p_cooldown_until <= NOW() THEN
    RAISE EXCEPTION 'GitHub cooldown must end in the future' USING ERRCODE = '22023';
  END IF;

  IF p_cooldown_reason IS NULL OR p_cooldown_reason NOT IN (
    'retry-after',
    'primary-rate-limit',
    'secondary-rate-limit'
  ) THEN
    RAISE EXCEPTION 'Invalid GitHub cooldown reason' USING ERRCODE = '22023';
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
      run_after = CASE
        WHEN p_next_status = 'queued' THEN GREATEST(COALESCE(p_run_after, NOW()), p_cooldown_until)
        ELSE run_after
      END,
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

  INSERT INTO public.service_cooldowns AS existing (
    service, blocked_until, reason, source_job_id, updated_at
  ) VALUES (
    'github', p_cooldown_until, p_cooldown_reason, current_job.id, NOW()
  )
  ON CONFLICT (service) DO UPDATE
  SET blocked_until = GREATEST(existing.blocked_until, EXCLUDED.blocked_until),
      reason = CASE
        WHEN EXCLUDED.blocked_until >= existing.blocked_until THEN EXCLUDED.reason
        ELSE existing.reason
      END,
      source_job_id = CASE
        WHEN EXCLUDED.blocked_until >= existing.blocked_until THEN EXCLUDED.source_job_id
        ELSE existing.source_job_id
      END,
      updated_at = NOW();

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    current_job.team_id,
    current_job.id,
    current_job.scrape_id,
    CASE WHEN p_next_status = 'failed' THEN 'failed' ELSE 'retry_scheduled' END,
    p_error,
    jsonb_build_object(
      'nextRun', CASE WHEN p_next_status = 'failed' THEN NULL ELSE GREATEST(p_run_after, p_cooldown_until) END,
      'retryDelayMs', p_retry_delay_ms,
      'attempt', current_job.attempts,
      'maxAttempts', current_job.max_attempts,
      'workerId', p_worker_id,
      'githubCooldownUntil', p_cooldown_until,
      'githubCooldownReason', p_cooldown_reason
    ),
    current_job.request_id
  );

  RETURN QUERY SELECT TRUE, p_next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scrape_job(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_scrape_job_step_with_github_cooldown(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, BIGINT, TIMESTAMPTZ, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.claim_scrape_job(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_scrape_job_step_with_github_cooldown(
  UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, BIGINT, TIMESTAMPTZ, TEXT
) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (37, 'github_rate_limit_cooldown')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
