-- Reuse recently fetched public GitHub profiles across overlapping scrapes
-- without treating recruiter-only edits as profile refreshes.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 35 AND name = 'verified_scrape_completion'
  ) THEN
    RAISE EXCEPTION 'Talon migration 035 must be applied before migration 036';
  END IF;
END $$;

ALTER TABLE public.contributors
  ADD COLUMN IF NOT EXISTS profile_refreshed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.mark_contributor_profile_refreshed()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.profile_refreshed_at := NOW();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_contributor_profile_refreshed() FROM PUBLIC;

DROP TRIGGER IF EXISTS contributors_profile_refreshed ON public.contributors;
CREATE TRIGGER contributors_profile_refreshed
BEFORE INSERT OR UPDATE OF
  github_username,
  name,
  avatar_url,
  bio,
  location,
  company,
  email,
  twitter,
  linkedin,
  website
ON public.contributors
FOR EACH ROW
EXECUTE FUNCTION public.mark_contributor_profile_refreshed();

CREATE OR REPLACE FUNCTION public.checkpoint_cached_scrape_hydration_batch(
  p_job_id UUID,
  p_worker_id TEXT,
  p_contributors JSONB
)
RETURNS TABLE(
  applied BOOLEAN,
  result_status TEXT,
  persisted_count INTEGER,
  processed_count INTEGER,
  candidate_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.scrape_jobs%ROWTYPE;
  payload_count INTEGER;
  calculated_progress INTEGER;
BEGIN
  IF p_worker_id IS NULL OR BTRIM(p_worker_id) = '' THEN
    RAISE EXCEPTION 'Worker id is required' USING ERRCODE = '22023';
  END IF;

  IF p_contributors IS NULL
    OR JSONB_TYPEOF(p_contributors) <> 'array'
    OR JSONB_ARRAY_LENGTH(p_contributors) < 1
    OR JSONB_ARRAY_LENGTH(p_contributors) > 20
    OR OCTET_LENGTH(p_contributors::TEXT) > 262144 THEN
    RAISE EXCEPTION 'Cached hydration batch payload is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO payload_count
  FROM JSONB_TO_RECORDSET(p_contributors) AS profile(
    username TEXT,
    contributions INTEGER
  );

  IF EXISTS (
    SELECT 1
    FROM JSONB_TO_RECORDSET(p_contributors) AS profile(
      username TEXT,
      contributions INTEGER
    )
    WHERE profile.username IS NULL
      OR BTRIM(profile.username) = ''
      OR profile.contributions IS NULL
      OR profile.contributions < 0
  ) OR (
    SELECT COUNT(DISTINCT profile.username)
    FROM JSONB_TO_RECORDSET(p_contributors) AS profile(username TEXT)
  ) <> payload_count THEN
    RAISE EXCEPTION 'Cached hydration batch contributor is invalid' USING ERRCODE = '22023';
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
      0,
      0;
    RETURN;
  END IF;

  IF current_job.state ->> 'phase' IS DISTINCT FROM 'hydrate' THEN
    RAISE EXCEPTION 'Scrape job is not ready for cached hydration' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM JSONB_TO_RECORDSET(p_contributors) AS profile(username TEXT, contributions INTEGER)
    LEFT JOIN public.scrape_job_contributions AS candidate
      ON candidate.job_id = current_job.id
      AND candidate.github_login = profile.username
    WHERE candidate.github_login IS NULL
      OR candidate.contributions < current_job.min_contributions
      OR candidate.contributions <> profile.contributions
  ) THEN
    RAISE EXCEPTION 'Cached hydration batch no longer matches job candidates' USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM JSONB_TO_RECORDSET(p_contributors) AS profile(username TEXT)
    LEFT JOIN public.contributors AS contributor
      ON contributor.team_id = current_job.team_id
      AND contributor.github_username = profile.username
      AND contributor.profile_refreshed_at >= NOW() - INTERVAL '7 days'
    WHERE contributor.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Cached contributor profile is missing or stale' USING ERRCODE = '40001';
  END IF;

  WITH payload AS (
    SELECT *
    FROM JSONB_TO_RECORDSET(p_contributors) AS profile(
      username TEXT,
      contributions INTEGER
    )
  )
  INSERT INTO public.scrape_contributors (scrape_id, contributor_id, contributions)
  SELECT current_job.scrape_id, contributor.id, payload.contributions
  FROM payload
  JOIN public.contributors AS contributor
    ON contributor.team_id = current_job.team_id
    AND contributor.github_username = payload.username
    AND contributor.profile_refreshed_at >= NOW() - INTERVAL '7 days'
  ON CONFLICT (scrape_id, contributor_id) DO UPDATE
  SET contributions = EXCLUDED.contributions;

  GET DIAGNOSTICS persisted_count = ROW_COUNT;

  IF persisted_count <> payload_count THEN
    RAISE EXCEPTION 'Cached hydration batch was not fully persisted' USING ERRCODE = '40001';
  END IF;

  SELECT COUNT(*) INTO candidate_count
  FROM public.scrape_job_contributions AS candidate
  WHERE candidate.job_id = current_job.id
    AND candidate.contributions >= current_job.min_contributions;

  SELECT COUNT(*) INTO processed_count
  FROM public.scrape_job_contributions AS candidate
  JOIN public.contributors AS contributor
    ON contributor.team_id = current_job.team_id
    AND contributor.github_username = candidate.github_login
  JOIN public.scrape_contributors AS link
    ON link.scrape_id = current_job.scrape_id
    AND link.contributor_id = contributor.id
  WHERE candidate.job_id = current_job.id
    AND candidate.contributions >= current_job.min_contributions;

  calculated_progress := CASE
    WHEN current_job.type = 'organization' THEN
      50 + ROUND((processed_count::NUMERIC / GREATEST(candidate_count, 1)) * 50)::INTEGER
    ELSE
      ROUND((processed_count::NUMERIC / GREATEST(candidate_count, 1)) * 100)::INTEGER
  END;

  UPDATE public.scrape_jobs
  SET updated_at = NOW()
  WHERE id = current_job.id;

  UPDATE public.scrapes
  SET current = processed_count,
      total = candidate_count,
      progress = LEAST(99, calculated_progress),
      current_user_login = NULL
  WHERE id = current_job.scrape_id
    AND team_id = current_job.team_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scrape not found for job' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    current_job.team_id,
    current_job.id,
    current_job.scrape_id,
    'cached_contributors_linked',
    'Linked contributors from the fresh profile cache',
    JSONB_BUILD_OBJECT(
      'count', persisted_count,
      'processed', processed_count,
      'total', candidate_count,
      'workerId', p_worker_id
    ),
    current_job.request_id
  );

  RETURN QUERY SELECT
    TRUE,
    'running'::TEXT,
    persisted_count,
    processed_count,
    candidate_count;
END;
$$;

REVOKE ALL ON FUNCTION public.checkpoint_cached_scrape_hydration_batch(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkpoint_cached_scrape_hydration_batch(UUID, TEXT, JSONB) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (36, 'contributor_profile_freshness_cache')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
