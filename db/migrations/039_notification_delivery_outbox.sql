-- Make watched-repository Slack delivery durable. The scrape completion
-- transaction enqueues a secret-free outbox record, while bounded workers
-- claim, retry, and finish delivery with lease-safe transitions.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 38 AND name = 'durable_watched_repo_checks'
  ) THEN
    RAISE EXCEPTION 'Talon migration 038 must be applied before migration 039';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind = 'watched_repo.slack'),
  dedupe_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts >= 1),
  run_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (kind, dedupe_key)
);

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notification_deliveries FROM anon, authenticated;
GRANT ALL ON TABLE public.notification_deliveries TO service_role;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_due
  ON public.notification_deliveries(status, run_after, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_team_created
  ON public.notification_deliveries(team_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.enqueue_watched_repo_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  watched_repo_id_text TEXT;
  scrape_id_text TEXT;
BEGIN
  IF NEW.type <> 'watched_repo.contributors_found' THEN
    RETURN NEW;
  END IF;

  watched_repo_id_text := NEW.metadata ->> 'watchedRepoId';
  scrape_id_text := NEW.metadata ->> 'scrapeId';
  IF watched_repo_id_text IS NULL OR scrape_id_text IS NULL THEN
    RAISE EXCEPTION 'Watched repository notification metadata is incomplete'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notification_deliveries (
    team_id, kind, dedupe_key, payload
  ) VALUES (
    NEW.team_id,
    'watched_repo.slack',
    'watched_repo:' || scrape_id_text,
    jsonb_build_object(
      'watchedRepoId', watched_repo_id_text,
      'scrapeId', scrape_id_text
    )
  )
  ON CONFLICT (kind, dedupe_key) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_watched_repo_notification ON public.activity_events;
CREATE TRIGGER trg_enqueue_watched_repo_notification
AFTER INSERT ON public.activity_events
FOR EACH ROW
WHEN (NEW.type = 'watched_repo.contributors_found')
EXECUTE FUNCTION public.enqueue_watched_repo_notification();

CREATE OR REPLACE FUNCTION public.recover_stale_notification_deliveries(
  p_stale_before TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recovered_count INTEGER := 0;
BEGIN
  IF p_stale_before IS NULL OR p_stale_before >= NOW() THEN
    RAISE EXCEPTION 'Stale cutoff must be in the past' USING ERRCODE = '22023';
  END IF;

  WITH recovered AS (
    UPDATE public.notification_deliveries
    SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
        run_after = CASE WHEN attempts >= max_attempts THEN run_after ELSE NOW() END,
        locked_at = NULL,
        locked_by = NULL,
        last_error = 'Delivery lease expired before completion',
        completed_at = CASE WHEN attempts >= max_attempts THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE status = 'running'
      AND locked_at < p_stale_before
    RETURNING payload, status
  ), failed_watches AS (
    UPDATE public.watched_repos AS watched
    SET last_notification_status = 'failed'
    FROM recovered
    WHERE recovered.status = 'failed'
      AND watched.id = (recovered.payload ->> 'watchedRepoId')::UUID
    RETURNING watched.id
  )
  SELECT COUNT(*) INTO recovered_count FROM recovered;

  RETURN recovered_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_notification_delivery(
  p_worker_id TEXT
)
RETURNS SETOF public.notification_deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed public.notification_deliveries%ROWTYPE;
BEGIN
  IF p_worker_id IS NULL OR BTRIM(p_worker_id) = '' THEN
    RAISE EXCEPTION 'Worker id is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO claimed
  FROM public.notification_deliveries
  WHERE status = 'queued'
    AND run_after <= NOW()
  ORDER BY run_after ASC, created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public.notification_deliveries
  SET status = 'running',
      attempts = claimed.attempts + 1,
      locked_at = NOW(),
      locked_by = p_worker_id,
      updated_at = NOW()
  WHERE id = claimed.id
  RETURNING * INTO claimed;

  UPDATE public.watched_repos
  SET last_notification_status = 'sending'
  WHERE id = (claimed.payload ->> 'watchedRepoId')::UUID
    AND team_id = claimed.team_id;

  RETURN NEXT claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_notification_delivery(
  p_delivery_id UUID,
  p_worker_id TEXT,
  p_outcome TEXT
)
RETURNS TABLE(applied BOOLEAN, result_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_delivery public.notification_deliveries%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('sent', 'not_configured', 'not_needed', 'invalid_configuration') THEN
    RAISE EXCEPTION 'Invalid notification outcome' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_delivery
  FROM public.notification_deliveries
  WHERE id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification delivery not found' USING ERRCODE = '23503';
  END IF;

  IF current_delivery.status <> 'running'
    OR current_delivery.locked_by IS DISTINCT FROM p_worker_id THEN
    RETURN QUERY SELECT FALSE, current_delivery.status;
    RETURN;
  END IF;

  UPDATE public.notification_deliveries
  SET status = 'succeeded',
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = current_delivery.id;

  UPDATE public.watched_repos
  SET last_notification_status = p_outcome
  WHERE id = (current_delivery.payload ->> 'watchedRepoId')::UUID
    AND team_id = current_delivery.team_id;

  RETURN QUERY SELECT TRUE, 'succeeded'::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_notification_delivery(
  p_delivery_id UUID,
  p_worker_id TEXT,
  p_error TEXT
)
RETURNS TABLE(applied BOOLEAN, result_status TEXT, next_run TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_delivery public.notification_deliveries%ROWTYPE;
  next_status TEXT;
  calculated_next_run TIMESTAMPTZ;
BEGIN
  SELECT * INTO current_delivery
  FROM public.notification_deliveries
  WHERE id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification delivery not found' USING ERRCODE = '23503';
  END IF;

  IF current_delivery.status <> 'running'
    OR current_delivery.locked_by IS DISTINCT FROM p_worker_id THEN
    RETURN QUERY SELECT FALSE, current_delivery.status, current_delivery.run_after;
    RETURN;
  END IF;

  next_status := CASE
    WHEN current_delivery.attempts >= current_delivery.max_attempts THEN 'failed'
    ELSE 'queued'
  END;
  calculated_next_run := CASE
    WHEN next_status = 'failed' THEN current_delivery.run_after
    ELSE NOW() + LEAST(
      INTERVAL '1 hour',
      INTERVAL '1 minute' * POWER(2, GREATEST(current_delivery.attempts - 1, 0))::DOUBLE PRECISION
    )
  END;

  UPDATE public.notification_deliveries
  SET status = next_status,
      run_after = calculated_next_run,
      locked_at = NULL,
      locked_by = NULL,
      last_error = LEFT(COALESCE(p_error, 'Unknown notification error'), 500),
      completed_at = CASE WHEN next_status = 'failed' THEN NOW() ELSE NULL END,
      updated_at = NOW()
  WHERE id = current_delivery.id;

  UPDATE public.watched_repos
  SET last_notification_status = CASE WHEN next_status = 'failed' THEN 'failed' ELSE 'retrying' END
  WHERE id = (current_delivery.payload ->> 'watchedRepoId')::UUID
    AND team_id = current_delivery.team_id;

  RETURN QUERY SELECT TRUE, next_status, calculated_next_run;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_notification_delivery_retention()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INTEGER := 0;
BEGIN
  DELETE FROM public.notification_deliveries
  WHERE status IN ('succeeded', 'failed')
    AND updated_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_failed_notification_deliveries(
  p_team_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  retried_count INTEGER := 0;
BEGIN
  UPDATE public.watched_repos AS watched
  SET last_notification_status = 'retrying'
  WHERE (p_team_id IS NULL OR watched.team_id = p_team_id)
    AND EXISTS (
      SELECT 1
      FROM public.notification_deliveries AS delivery
      WHERE delivery.status = 'failed'
        AND delivery.team_id = watched.team_id
        AND watched.id = (delivery.payload ->> 'watchedRepoId')::UUID
    );

  UPDATE public.notification_deliveries
  SET status = 'queued',
      attempts = 0,
      run_after = NOW(),
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      completed_at = NULL,
      updated_at = NOW()
  WHERE status = 'failed'
    AND (p_team_id IS NULL OR team_id = p_team_id);
  GET DIAGNOSTICS retried_count = ROW_COUNT;

  RETURN retried_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_watched_repo_notification() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recover_stale_notification_deliveries(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_notification_delivery(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_notification_delivery(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_notification_delivery(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_notification_delivery_retention() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retry_failed_notification_deliveries(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.recover_stale_notification_deliveries(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_notification_delivery(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_notification_delivery(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_notification_delivery(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_notification_delivery_retention() TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_failed_notification_deliveries(UUID) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (39, 'notification_delivery_outbox')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
