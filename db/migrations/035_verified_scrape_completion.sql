-- Derive completion totals from the database and refuse to complete until the
-- persisted scrape links exactly cover every eligible job candidate.

CREATE OR REPLACE FUNCTION public.complete_scrape_job_verified(
  p_job_id UUID,
  p_worker_id TEXT
)
RETURNS TABLE(
  applied BOOLEAN,
  result_status TEXT,
  contributor_total INTEGER,
  contact_info_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.scrape_jobs%ROWTYPE;
  candidate_count INTEGER;
  linked_candidate_count INTEGER;
  calculated_contributor_total INTEGER;
  calculated_contact_info_count INTEGER;
BEGIN
  IF p_worker_id IS NULL OR BTRIM(p_worker_id) = '' THEN
    RAISE EXCEPTION 'Worker id is required' USING ERRCODE = '22023';
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
    RETURN QUERY SELECT
      FALSE,
      CASE WHEN current_job.cancel_requested THEN 'canceled'::TEXT ELSE current_job.status END,
      0,
      0;
    RETURN;
  END IF;

  IF current_job.state ->> 'phase' IS DISTINCT FROM 'hydrate' THEN
    RAISE EXCEPTION 'Scrape job is not ready for completion' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO candidate_count
  FROM public.scrape_job_contributions AS candidate
  WHERE candidate.job_id = current_job.id
    AND candidate.contributions >= current_job.min_contributions;

  SELECT COUNT(*) INTO linked_candidate_count
  FROM public.scrape_job_contributions AS candidate
  JOIN public.contributors AS contributor
    ON contributor.team_id = current_job.team_id
    AND contributor.github_username = candidate.github_login
  JOIN public.scrape_contributors AS link
    ON link.scrape_id = current_job.scrape_id
    AND link.contributor_id = contributor.id
    AND link.contributions = candidate.contributions
  WHERE candidate.job_id = current_job.id
    AND candidate.contributions >= current_job.min_contributions;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE
      NULLIF(BTRIM(contributor.email), '') IS NOT NULL
      OR NULLIF(BTRIM(contributor.twitter), '') IS NOT NULL
      OR NULLIF(BTRIM(contributor.linkedin), '') IS NOT NULL
      OR NULLIF(BTRIM(contributor.website), '') IS NOT NULL
    )
  INTO calculated_contributor_total, calculated_contact_info_count
  FROM public.scrape_contributors AS link
  JOIN public.contributors AS contributor
    ON contributor.id = link.contributor_id
    AND contributor.team_id = current_job.team_id
  WHERE link.scrape_id = current_job.scrape_id;

  IF linked_candidate_count <> candidate_count
    OR calculated_contributor_total <> candidate_count THEN
    RAISE EXCEPTION 'Scrape hydration is incomplete: % of % candidates linked with % total links',
      linked_candidate_count,
      candidate_count,
      calculated_contributor_total
      USING ERRCODE = '40001';
  END IF;

  UPDATE public.scrapes
  SET status = 'completed',
      progress = 100,
      current = calculated_contributor_total,
      total = calculated_contributor_total,
      completed_at = NOW(),
      error = NULL,
      current_user_login = NULL,
      contact_info_count = calculated_contact_info_count,
      total_contributors = calculated_contributor_total
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
    JSONB_BUILD_OBJECT(
      'workerId', p_worker_id,
      'contributorTotal', calculated_contributor_total,
      'contactInfoCount', calculated_contact_info_count
    ),
    current_job.request_id
  );

  INSERT INTO public.activity_events (
    team_id, actor_email, type, title, description, metadata
  ) VALUES (
    current_job.team_id,
    NULL,
    'scrape.completed',
    'Scrape completed',
    'Found ' || calculated_contributor_total || ' contributor' ||
      CASE WHEN calculated_contributor_total = 1 THEN '' ELSE 's' END ||
      ' in ' || current_job.target || '.',
    JSONB_BUILD_OBJECT(
      'scrapeId', current_job.scrape_id,
      'type', current_job.type,
      'target', current_job.target,
      'contributorTotal', calculated_contributor_total,
      'contactInfoCount', calculated_contact_info_count
    )
  );

  RETURN QUERY SELECT
    TRUE,
    'succeeded'::TEXT,
    calculated_contributor_total,
    calculated_contact_info_count;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_scrape_job_verified(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_scrape_job_verified(UUID, TEXT) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (35, 'verified_scrape_completion')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
