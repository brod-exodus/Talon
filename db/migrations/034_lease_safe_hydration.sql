-- Commit hydrated contributor profiles, scrape links, progress, and the worker
-- event together only while the caller still owns the active job lease.

CREATE OR REPLACE FUNCTION public.checkpoint_scrape_hydration_batch(
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
    OR OCTET_LENGTH(p_contributors::TEXT) > 1048576 THEN
    RAISE EXCEPTION 'Hydration batch payload is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO payload_count
  FROM JSONB_TO_RECORDSET(p_contributors) AS profile(
    username TEXT,
    name TEXT,
    avatar TEXT,
    contributions INTEGER,
    bio TEXT,
    location TEXT,
    company TEXT,
    email TEXT,
    twitter TEXT,
    linkedin TEXT,
    website TEXT
  );

  IF EXISTS (
    SELECT 1
    FROM JSONB_TO_RECORDSET(p_contributors) AS profile(
      username TEXT,
      name TEXT,
      avatar TEXT,
      contributions INTEGER,
      bio TEXT,
      location TEXT,
      company TEXT,
      email TEXT,
      twitter TEXT,
      linkedin TEXT,
      website TEXT
    )
    WHERE profile.username IS NULL
      OR BTRIM(profile.username) = ''
      OR profile.contributions IS NULL
      OR profile.contributions < 0
  ) OR (
    SELECT COUNT(DISTINCT profile.username)
    FROM JSONB_TO_RECORDSET(p_contributors) AS profile(username TEXT)
  ) <> payload_count THEN
    RAISE EXCEPTION 'Hydration batch contributor is invalid' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Scrape job is not ready for hydration' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Hydration batch no longer matches job candidates' USING ERRCODE = '40001';
  END IF;

  WITH payload AS (
    SELECT *
    FROM JSONB_TO_RECORDSET(p_contributors) AS profile(
      username TEXT,
      name TEXT,
      avatar TEXT,
      contributions INTEGER,
      bio TEXT,
      location TEXT,
      company TEXT,
      email TEXT,
      twitter TEXT,
      linkedin TEXT,
      website TEXT
    )
  ), upserted AS (
    INSERT INTO public.contributors (
      team_id,
      github_username,
      name,
      avatar_url,
      bio,
      location,
      company,
      email,
      twitter,
      linkedin,
      website,
      updated_at
    )
    SELECT
      current_job.team_id,
      payload.username,
      COALESCE(NULLIF(BTRIM(payload.name), ''), payload.username),
      NULLIF(BTRIM(payload.avatar), ''),
      NULLIF(BTRIM(payload.bio), ''),
      NULLIF(BTRIM(payload.location), ''),
      NULLIF(BTRIM(payload.company), ''),
      NULLIF(BTRIM(payload.email), ''),
      NULLIF(BTRIM(payload.twitter), ''),
      NULLIF(BTRIM(payload.linkedin), ''),
      NULLIF(BTRIM(payload.website), ''),
      NOW()
    FROM payload
    ON CONFLICT (team_id, github_username) DO UPDATE
    SET name = EXCLUDED.name,
        avatar_url = EXCLUDED.avatar_url,
        bio = EXCLUDED.bio,
        location = EXCLUDED.location,
        company = EXCLUDED.company,
        email = EXCLUDED.email,
        twitter = EXCLUDED.twitter,
        linkedin = EXCLUDED.linkedin,
        website = EXCLUDED.website,
        updated_at = NOW()
    RETURNING id, github_username
  )
  INSERT INTO public.scrape_contributors (scrape_id, contributor_id, contributions)
  SELECT current_job.scrape_id, upserted.id, payload.contributions
  FROM upserted
  JOIN payload ON payload.username = upserted.github_username
  ON CONFLICT (scrape_id, contributor_id) DO UPDATE
  SET contributions = EXCLUDED.contributions;

  GET DIAGNOSTICS persisted_count = ROW_COUNT;

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
    'contributors_persisted',
    'Persisted hydrated contributors',
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

REVOKE ALL ON FUNCTION public.checkpoint_scrape_hydration_batch(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkpoint_scrape_hydration_batch(UUID, TEXT, JSONB) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (34, 'lease_safe_hydration')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
