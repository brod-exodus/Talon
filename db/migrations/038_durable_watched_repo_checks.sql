-- Run watched-repository checks through Talon's bounded scrape worker. This
-- makes checks resumable, interval-aware, and observable without exposing
-- their internal scrapes in the normal scrape history.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 37 AND name = 'github_rate_limit_cooldown'
  ) THEN
    RAISE EXCEPTION 'Talon migration 037 must be applied before migration 038';
  END IF;
END $$;

ALTER TABLE public.scrapes
  ADD COLUMN IF NOT EXISTS watched_repo_id UUID
    REFERENCES public.watched_repos(id) ON DELETE CASCADE;

ALTER TABLE public.watched_repo_contributors
  ADD COLUMN IF NOT EXISTS detected_scrape_id TEXT
    REFERENCES public.scrapes(id) ON DELETE SET NULL;

ALTER TABLE public.watched_repos
  ADD COLUMN IF NOT EXISTS check_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS last_check_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_check_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_check_error TEXT,
  ADD COLUMN IF NOT EXISTS last_new_contributors INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_baselined_contributors INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_notification_status TEXT;

ALTER TABLE public.watched_repos
  DROP CONSTRAINT IF EXISTS watched_repos_check_status_check;
ALTER TABLE public.watched_repos
  ADD CONSTRAINT watched_repos_check_status_check
  CHECK (check_status IN ('idle', 'queued', 'running', 'succeeded', 'failed'));

ALTER TABLE public.watched_repos
  DROP CONSTRAINT IF EXISTS watched_repos_last_new_contributors_check;
ALTER TABLE public.watched_repos
  ADD CONSTRAINT watched_repos_last_new_contributors_check
  CHECK (last_new_contributors >= 0);

ALTER TABLE public.watched_repos
  DROP CONSTRAINT IF EXISTS watched_repos_last_baselined_contributors_check;
ALTER TABLE public.watched_repos
  ADD CONSTRAINT watched_repos_last_baselined_contributors_check
  CHECK (last_baselined_contributors >= 0);

CREATE INDEX IF NOT EXISTS idx_scrapes_watched_repo_id
  ON public.scrapes(watched_repo_id)
  WHERE watched_repo_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_scrapes_one_active_watch_check
  ON public.scrapes(watched_repo_id)
  WHERE watched_repo_id IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_watched_repo_contributors_detected_scrape
  ON public.watched_repo_contributors(detected_scrape_id)
  WHERE detected_scrape_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enqueue_due_watched_repo_scrapes(
  p_team_id UUID DEFAULT NULL,
  p_force BOOLEAN DEFAULT FALSE,
  p_request_id UUID DEFAULT NULL
)
RETURNS TABLE(
  watched_repo_id UUID,
  repo TEXT,
  scrape_id TEXT,
  job_id UUID,
  replayed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  watched public.watched_repos%ROWTYPE;
  new_scrape_id TEXT;
  new_job_id UUID;
BEGIN
  FOR watched IN
    SELECT watch.*
    FROM public.watched_repos AS watch
    WHERE watch.active = TRUE
      AND (p_team_id IS NULL OR watch.team_id = p_team_id)
      AND (
        p_force
        OR COALESCE(watch.last_checked_at, watch.last_check_completed_at)
          IS NULL
        OR COALESCE(watch.last_checked_at, watch.last_check_completed_at)
          + make_interval(hours => watch.interval_hours) <= NOW()
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.scrapes AS active_scrape
        WHERE active_scrape.watched_repo_id = watch.id
          AND active_scrape.status = 'active'
      )
    ORDER BY COALESCE(watch.last_checked_at, watch.last_check_completed_at) ASC NULLS FIRST,
      watch.created_at ASC
    FOR UPDATE OF watch SKIP LOCKED
  LOOP
    new_scrape_id := 'watch-' || REPLACE(gen_random_uuid()::TEXT, '-', '');

    INSERT INTO public.scrapes (
      id, team_id, type, target, status, progress, current, total,
      current_user_login, started_at, completed_at, error,
      min_contributions, watched_repo_id
    ) VALUES (
      new_scrape_id, watched.team_id, 'repository', watched.repo, 'active',
      0, 0, 0, NULL, NOW(), NULL, NULL, 1, watched.id
    );

    INSERT INTO public.scrape_jobs (
      scrape_id, team_id, type, target, min_contributions, status,
      run_after, state, cancel_requested, request_id
    ) VALUES (
      new_scrape_id, watched.team_id, 'repository', watched.repo, 1,
      'queued', NOW(), '{}'::JSONB, FALSE, p_request_id
    )
    RETURNING id INTO new_job_id;

    INSERT INTO public.scrape_job_events (
      team_id, job_id, scrape_id, event_type, message, metadata, request_id
    ) VALUES (
      watched.team_id, new_job_id, new_scrape_id, 'queued',
      FORMAT('Queued watched repository check for %s', watched.repo),
      jsonb_build_object('watchedRepoId', watched.id, 'repo', watched.repo),
      p_request_id
    );

    UPDATE public.watched_repos
    SET check_status = 'queued',
        last_check_error = NULL,
        last_notification_status = NULL
    WHERE id = watched.id;

    RETURN QUERY SELECT watched.id, watched.repo, new_scrape_id, new_job_id, FALSE;
  END LOOP;

  -- Forced checks return existing active work so browser retries remain safe.
  IF p_force THEN
    RETURN QUERY
    SELECT watch.id, watch.repo, scrape.id, job.id, TRUE
    FROM public.watched_repos AS watch
    JOIN public.scrapes AS scrape
      ON scrape.watched_repo_id = watch.id
      AND scrape.status = 'active'
    JOIN public.scrape_jobs AS job ON job.scrape_id = scrape.id
    WHERE watch.active = TRUE
      AND (p_team_id IS NULL OR watch.team_id = p_team_id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.scrape_job_events AS event
        WHERE event.job_id = job.id
          AND event.event_type = 'queued'
          AND event.request_id IS NOT DISTINCT FROM p_request_id
      );
  END IF;
END;
$$;

-- Preserve the GitHub cooldown gate while marking an internal watch check as
-- running in the same transaction that claims its worker lease.
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
  claimed_watch_id UUID;
BEGIN
  IF p_worker_id IS NULL OR BTRIM(p_worker_id) = '' THEN
    RAISE EXCEPTION 'Worker id is required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.service_cooldowns
    WHERE service = 'github' AND blocked_until > NOW()
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

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.scrape_jobs
  SET status = 'running', attempts = claimed_job.attempts + 1,
      locked_at = NOW(), locked_by = p_worker_id, updated_at = NOW()
  WHERE id = claimed_job.id
  RETURNING * INTO claimed_job;

  SELECT scrape.watched_repo_id INTO claimed_watch_id
  FROM public.scrapes AS scrape
  WHERE scrape.id = claimed_job.scrape_id;

  IF claimed_watch_id IS NOT NULL THEN
    UPDATE public.watched_repos
    SET check_status = 'running',
        last_check_started_at = COALESCE(last_check_started_at, NOW()),
        last_check_error = NULL
    WHERE id = claimed_watch_id;
  END IF;

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    claimed_job.team_id, claimed_job.id, claimed_job.scrape_id, 'claimed',
    'Worker claimed scrape job',
    jsonb_build_object('workerId', p_worker_id, 'attempt', claimed_job.attempts),
    claimed_job.request_id
  );

  RETURN NEXT claimed_job;
END;
$$;

DROP FUNCTION IF EXISTS public.complete_scrape_job_verified(UUID, TEXT);

CREATE FUNCTION public.complete_scrape_job_verified(
  p_job_id UUID,
  p_worker_id TEXT
)
RETURNS TABLE(
  applied BOOLEAN,
  result_status TEXT,
  contributor_total INTEGER,
  contact_info_count INTEGER,
  result_watched_repo_id UUID,
  new_contributor_count INTEGER,
  baseline_contributor_count INTEGER
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
  current_watch public.watched_repos%ROWTYPE;
  current_watch_id UUID;
  is_initial_baseline BOOLEAN := FALSE;
  inserted_watch_contributors INTEGER := 0;
  calculated_new_contributors INTEGER := 0;
  calculated_baseline_contributors INTEGER := 0;
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

  SELECT scrape.watched_repo_id INTO current_watch_id
  FROM public.scrapes AS scrape
  WHERE scrape.id = current_job.scrape_id
    AND scrape.team_id = current_job.team_id;

  IF current_job.status <> 'running'
    OR current_job.locked_by IS DISTINCT FROM p_worker_id
    OR current_job.cancel_requested THEN
    RETURN QUERY SELECT FALSE,
      CASE WHEN current_job.cancel_requested THEN 'canceled'::TEXT ELSE current_job.status END,
      0, 0, current_watch_id, 0, 0;
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

  SELECT COUNT(*), COUNT(*) FILTER (WHERE
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
      linked_candidate_count, candidate_count, calculated_contributor_total
      USING ERRCODE = '40001';
  END IF;

  IF current_watch_id IS NOT NULL THEN
    SELECT * INTO current_watch
    FROM public.watched_repos
    WHERE id = current_watch_id AND team_id = current_job.team_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Watched repository not found for scrape' USING ERRCODE = '23503';
    END IF;

    is_initial_baseline := current_watch.last_checked_at IS NULL;

    INSERT INTO public.watched_repo_contributors (
      team_id, watched_repo_id, github_username, first_seen_at, detected_scrape_id
    )
    SELECT current_job.team_id, current_watch_id, contributor.github_username,
      NOW(), current_job.scrape_id
    FROM public.scrape_contributors AS link
    JOIN public.contributors AS contributor
      ON contributor.id = link.contributor_id
      AND contributor.team_id = current_job.team_id
    WHERE link.scrape_id = current_job.scrape_id
    ON CONFLICT (watched_repo_id, github_username) DO NOTHING;

    GET DIAGNOSTICS inserted_watch_contributors = ROW_COUNT;
    calculated_new_contributors := CASE WHEN is_initial_baseline THEN 0 ELSE inserted_watch_contributors END;
    calculated_baseline_contributors := CASE WHEN is_initial_baseline THEN inserted_watch_contributors ELSE 0 END;
  END IF;

  UPDATE public.scrapes
  SET status = 'completed', progress = 100,
      current = calculated_contributor_total, total = calculated_contributor_total,
      completed_at = NOW(), error = NULL, current_user_login = NULL,
      contact_info_count = calculated_contact_info_count,
      total_contributors = calculated_contributor_total
  WHERE id = current_job.scrape_id AND team_id = current_job.team_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scrape not found for job' USING ERRCODE = '23503';
  END IF;

  UPDATE public.scrape_jobs
  SET status = 'succeeded', locked_at = NULL, locked_by = NULL,
      last_error = NULL, cancel_requested = FALSE, updated_at = NOW()
  WHERE id = current_job.id;

  IF current_watch_id IS NOT NULL THEN
    UPDATE public.watched_repos
    SET check_status = 'succeeded',
        last_checked_at = NOW(),
        last_check_completed_at = NOW(),
        last_check_error = NULL,
        last_new_contributors = calculated_new_contributors,
        last_baselined_contributors = calculated_baseline_contributors,
        last_notification_status = CASE
          WHEN calculated_new_contributors > 0 THEN 'pending'
          ELSE 'not_needed'
        END
    WHERE id = current_watch_id;
  END IF;

  INSERT INTO public.scrape_job_events (
    team_id, job_id, scrape_id, event_type, message, metadata, request_id
  ) VALUES (
    current_job.team_id, current_job.id, current_job.scrape_id, 'succeeded',
    'Scrape job succeeded',
    jsonb_build_object(
      'workerId', p_worker_id,
      'contributorTotal', calculated_contributor_total,
      'contactInfoCount', calculated_contact_info_count,
      'watchedRepoId', current_watch_id,
      'newContributors', calculated_new_contributors,
      'baselinedContributors', calculated_baseline_contributors
    ),
    current_job.request_id
  );

  IF current_watch_id IS NULL THEN
    INSERT INTO public.activity_events (
      team_id, actor_email, type, title, description, metadata
    ) VALUES (
      current_job.team_id, NULL, 'scrape.completed', 'Scrape completed',
      'Found ' || calculated_contributor_total || ' contributor' ||
        CASE WHEN calculated_contributor_total = 1 THEN '' ELSE 's' END ||
        ' in ' || current_job.target || '.',
      jsonb_build_object(
        'scrapeId', current_job.scrape_id, 'type', current_job.type,
        'target', current_job.target,
        'contributorTotal', calculated_contributor_total,
        'contactInfoCount', calculated_contact_info_count
      )
    );
  ELSIF calculated_new_contributors > 0 THEN
    INSERT INTO public.activity_events (
      team_id, actor_email, type, title, description, metadata
    ) VALUES (
      current_job.team_id, NULL, 'watched_repo.contributors_found',
      'Contributors found',
      calculated_new_contributors || ' new contributor' ||
        CASE WHEN calculated_new_contributors = 1 THEN '' ELSE 's' END ||
        ' in ' || current_job.target,
      jsonb_build_object(
        'watchedRepoId', current_watch_id, 'repo', current_job.target,
        'newContributors', calculated_new_contributors,
        'scrapeId', current_job.scrape_id
      )
    );
  END IF;

  RETURN QUERY SELECT TRUE, 'succeeded'::TEXT,
    calculated_contributor_total, calculated_contact_info_count,
    current_watch_id, calculated_new_contributors,
    calculated_baseline_contributors;
END;
$$;

-- Terminal scrape failures and cancellations persist on the watch without
-- duplicating failure logic across each queue transition function.
CREATE OR REPLACE FUNCTION public.sync_watched_repo_terminal_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.watched_repo_id IS NOT NULL
    AND NEW.status IN ('failed', 'canceled')
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.watched_repos
    SET check_status = 'failed',
        last_check_completed_at = NOW(),
        last_check_error = COALESCE(NULLIF(NEW.error, ''), 'Watched repository check was canceled'),
        last_new_contributors = 0,
        last_baselined_contributors = 0,
        last_notification_status = 'not_needed'
    WHERE id = NEW.watched_repo_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_watched_repo_terminal_status ON public.scrapes;
CREATE TRIGGER trg_sync_watched_repo_terminal_status
AFTER UPDATE OF status ON public.scrapes
FOR EACH ROW
EXECUTE FUNCTION public.sync_watched_repo_terminal_status();

REVOKE ALL ON FUNCTION public.enqueue_due_watched_repo_scrapes(UUID, BOOLEAN, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_scrape_job(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_scrape_job_verified(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_watched_repo_terminal_status() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.enqueue_due_watched_repo_scrapes(UUID, BOOLEAN, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_scrape_job(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_scrape_job_verified(UUID, TEXT) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (38, 'durable_watched_repo_checks')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
