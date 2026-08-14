-- Stage organization contributor pages by repository and merge them into the
-- job aggregate exactly once when the repository's final page is checkpointed.

CREATE TABLE IF NOT EXISTS public.scrape_job_repository_contributions (
  job_id UUID NOT NULL REFERENCES public.scrape_jobs(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  repository TEXT NOT NULL,
  github_login TEXT NOT NULL,
  contributions INTEGER NOT NULL CHECK (contributions >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, repository, github_login)
);

CREATE INDEX IF NOT EXISTS idx_scrape_job_repository_contributions_team_job
  ON public.scrape_job_repository_contributions(team_id, job_id);

ALTER TABLE public.scrape_job_repository_contributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.scrape_job_repository_contributions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.checkpoint_organization_contributor_page(
  p_job_id UUID,
  p_worker_id TEXT,
  p_repository TEXT,
  p_expected_repo_index INTEGER,
  p_expected_page INTEGER,
  p_has_next BOOLEAN,
  p_contributions JSONB
)
RETURNS TABLE(
  applied BOOLEAN,
  result_status TEXT,
  next_repo_index INTEGER,
  next_page INTEGER,
  discovery_complete BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_job public.scrape_jobs%ROWTYPE;
  current_repo_index INTEGER;
  current_page INTEGER;
  repository_count INTEGER;
  calculated_next_repo_index INTEGER;
  calculated_next_page INTEGER;
  calculated_complete BOOLEAN;
  next_phase TEXT;
  next_state JSONB;
  page_contributor_count INTEGER;
BEGIN
  IF p_worker_id IS NULL OR BTRIM(p_worker_id) = '' THEN
    RAISE EXCEPTION 'Worker id is required' USING ERRCODE = '22023';
  END IF;

  IF p_repository IS NULL OR BTRIM(p_repository) = '' THEN
    RAISE EXCEPTION 'Repository is required' USING ERRCODE = '22023';
  END IF;

  IF p_expected_repo_index IS NULL OR p_expected_repo_index < 0
    OR p_expected_page IS NULL OR p_expected_page < 1
    OR p_has_next IS NULL THEN
    RAISE EXCEPTION 'Organization contributor cursor is invalid' USING ERRCODE = '22023';
  END IF;

  IF p_contributions IS NULL
    OR JSONB_TYPEOF(p_contributions) <> 'array'
    OR JSONB_ARRAY_LENGTH(p_contributions) > 100 THEN
    RAISE EXCEPTION 'Organization contributor page payload is invalid' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM JSONB_TO_RECORDSET(p_contributions) AS contribution(login TEXT, contributions INTEGER)
    WHERE contribution.login IS NULL
      OR BTRIM(contribution.login) = ''
      OR contribution.contributions IS NULL
      OR contribution.contributions < 0
  ) THEN
    RAISE EXCEPTION 'Organization contributor row is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_job
  FROM public.scrape_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scrape job not found' USING ERRCODE = '23503';
  END IF;

  current_repo_index := COALESCE((current_job.state ->> 'repoIndex')::INTEGER, 0);
  current_page := COALESCE((current_job.state ->> 'contributorPage')::INTEGER, 1);

  IF current_job.status <> 'running'
    OR current_job.locked_by IS DISTINCT FROM p_worker_id
    OR current_job.cancel_requested THEN
    RETURN QUERY SELECT
      FALSE,
      CASE WHEN current_job.cancel_requested THEN 'canceled'::TEXT ELSE current_job.status END,
      current_repo_index,
      current_page,
      FALSE;
    RETURN;
  END IF;

  IF JSONB_TYPEOF(current_job.state -> 'repositories') <> 'array' THEN
    RAISE EXCEPTION 'Organization repository state is unavailable' USING ERRCODE = '22023';
  END IF;

  repository_count := JSONB_ARRAY_LENGTH(current_job.state -> 'repositories');
  IF p_expected_repo_index >= repository_count
    OR current_job.state -> 'repositories' ->> p_expected_repo_index IS DISTINCT FROM p_repository
    OR current_repo_index <> p_expected_repo_index
    OR current_page <> p_expected_page THEN
    RAISE EXCEPTION 'Organization contributor checkpoint cursor is stale' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.scrape_job_repository_contributions (
    job_id, team_id, repository, github_login, contributions, updated_at
  )
  SELECT
    current_job.id,
    current_job.team_id,
    p_repository,
    contribution.login,
    MAX(contribution.contributions),
    NOW()
  FROM JSONB_TO_RECORDSET(p_contributions) AS contribution(login TEXT, contributions INTEGER)
  GROUP BY contribution.login
  ON CONFLICT (job_id, repository, github_login) DO UPDATE
  SET contributions = EXCLUDED.contributions,
      updated_at = NOW();

  SELECT COUNT(*) INTO page_contributor_count
  FROM JSONB_TO_RECORDSET(p_contributions) AS contribution(login TEXT, contributions INTEGER);

  calculated_next_repo_index := CASE
    WHEN p_has_next THEN current_repo_index
    ELSE current_repo_index + 1
  END;
  calculated_next_page := CASE WHEN p_has_next THEN current_page + 1 ELSE 1 END;
  calculated_complete := NOT p_has_next AND calculated_next_repo_index >= repository_count;
  next_phase := CASE WHEN calculated_complete THEN 'hydrate' ELSE 'discover' END;

  IF NOT p_has_next THEN
    INSERT INTO public.scrape_job_contributions (
      job_id, team_id, github_login, contributions, updated_at
    )
    SELECT
      current_job.id,
      current_job.team_id,
      staged.github_login,
      SUM(staged.contributions)::INTEGER,
      NOW()
    FROM public.scrape_job_repository_contributions AS staged
    WHERE staged.job_id = current_job.id
      AND staged.repository = p_repository
    GROUP BY staged.github_login
    ON CONFLICT (job_id, github_login) DO UPDATE
    SET contributions = public.scrape_job_contributions.contributions + EXCLUDED.contributions,
        updated_at = NOW();

    DELETE FROM public.scrape_job_repository_contributions
    WHERE job_id = current_job.id
      AND repository = p_repository;
  END IF;

  next_state := JSONB_SET(
    JSONB_SET(
      JSONB_SET(current_job.state, '{phase}', TO_JSONB(next_phase), TRUE),
      '{repoIndex}',
      TO_JSONB(calculated_next_repo_index),
      TRUE
    ),
    '{contributorPage}',
    TO_JSONB(calculated_next_page),
    TRUE
  );

  UPDATE public.scrape_jobs
  SET state = next_state,
      updated_at = NOW()
  WHERE id = current_job.id;

  IF NOT p_has_next THEN
    UPDATE public.scrapes
    SET current = calculated_next_repo_index,
        total = repository_count,
        progress = ROUND((calculated_next_repo_index::NUMERIC / GREATEST(repository_count, 1)) * 50)::INTEGER,
        current_user_login = NULL
    WHERE id = current_job.scrape_id
      AND team_id = current_job.team_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Scrape not found for job' USING ERRCODE = '23503';
    END IF;
  END IF;

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    current_job.team_id,
    current_job.id,
    current_job.scrape_id,
    'organization_contributor_page_scanned',
    'Scanned organization repository contributor page',
    JSONB_BUILD_OBJECT(
      'repository', p_repository,
      'page', p_expected_page,
      'hasNext', p_has_next,
      'contributorCount', page_contributor_count,
      'nextRepoIndex', calculated_next_repo_index,
      'nextPage', calculated_next_page
    ),
    current_job.request_id
  );

  RETURN QUERY SELECT
    TRUE,
    'running'::TEXT,
    calculated_next_repo_index,
    calculated_next_page,
    calculated_complete;
END;
$$;

REVOKE ALL ON FUNCTION public.checkpoint_organization_contributor_page(UUID, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.checkpoint_organization_contributor_page(UUID, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, JSONB) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (33, 'replay_safe_organization_contributors')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
