-- Prevent one workspace, one long-running job, or background watched-repository
-- work from monopolizing Talon's shared GitHub worker. Claim decisions are
-- serialized briefly, while execution remains concurrent and lease-safe.

SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 46 AND name = 'bounded_active_sessions'
  ) THEN
    RAISE EXCEPTION 'Talon migration 046 must be applied before migration 047';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scrape_job_events_claimed_team_job_created_at
  ON public.scrape_job_events(team_id, job_id, created_at DESC)
  WHERE event_type = 'claimed';

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

  -- Claim selection is short, but it must observe the claim event committed by
  -- the previous selector. Execution happens after this transaction and is not
  -- serialized by this advisory lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('talon-scrape-job-claim', 0));

  IF EXISTS (
    SELECT 1
    FROM public.service_cooldowns
    WHERE service = 'github'
      AND blocked_until > NOW()
  ) THEN
    RETURN;
  END IF;

  SELECT job.* INTO claimed_job
  FROM public.scrape_jobs AS job
  JOIN public.scrapes AS scrape
    ON scrape.id = job.scrape_id
   AND scrape.team_id = job.team_id
  WHERE job.status = 'queued'
    AND job.cancel_requested = FALSE
    AND job.run_after <= NOW()
    AND (p_team_id IS NULL OR job.team_id = p_team_id)
  ORDER BY
    -- User-started work takes precedence, but aging prevents background watch
    -- checks from starving during a sustained interactive workload.
    (scrape.watched_repo_id IS NULL OR job.created_at <= NOW() - INTERVAL '15 minutes') DESC,
    -- Rotate across workspaces, then across jobs within a workspace.
    COALESCE((
      SELECT MAX(team_event.created_at)
      FROM public.scrape_job_events AS team_event
      WHERE team_event.team_id = job.team_id
        AND team_event.event_type = 'claimed'
    ), '-infinity'::TIMESTAMPTZ) ASC,
    COALESCE((
      SELECT MAX(job_event.created_at)
      FROM public.scrape_job_events AS job_event
      WHERE job_event.team_id = job.team_id
        AND job_event.job_id = job.id
        AND job_event.event_type = 'claimed'
    ), '-infinity'::TIMESTAMPTZ) ASC,
    job.run_after ASC,
    job.created_at ASC
  LIMIT 1
  FOR UPDATE OF job SKIP LOCKED;

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
      'attempt', claimed_job.attempts,
      'schedulingPolicy', 'interactive_workspace_job_fair'
    ),
    claimed_job.request_id
  );

  RETURN NEXT claimed_job;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_scrape_job(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_scrape_job(TEXT, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_talon_scheduling_contract_issues()
RETURNS TABLE(requirement_type TEXT, requirement_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    'index'::TEXT,
    'public.idx_scrape_job_events_claimed_team_job_created_at'::TEXT
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS index_relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = index_relation.relnamespace
    JOIN pg_catalog.pg_index AS index_record ON index_record.indexrelid = index_relation.oid
    WHERE namespace.nspname = 'public'
      AND index_relation.relname = 'idx_scrape_job_events_claimed_team_job_created_at'
      AND index_record.indisvalid
      AND index_record.indisready
  )
  ORDER BY requirement_type, requirement_name;
$$;

REVOKE ALL ON FUNCTION public.get_talon_scheduling_contract_issues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_talon_scheduling_contract_issues() TO service_role;

DO $$
DECLARE
  first_issue RECORD;
BEGIN
  SELECT * INTO first_issue
  FROM public.get_talon_scheduling_contract_issues()
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Talon scheduling contract is incomplete: % %',
      first_issue.requirement_type,
      first_issue.requirement_name;
  END IF;
END $$;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (47, 'fair_scrape_job_scheduling')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
