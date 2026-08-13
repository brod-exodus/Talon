-- Add an explicit lifecycle to public share links and bounded retention for
-- operational records. This is an expand-first migration: the legacy id stays
-- untouched while the old application is deployed, and the new application
-- resolves links through token_hash. The daily cleanup then replaces legacy raw
-- ids with opaque UUIDs once those legacy links expire.

ALTER TABLE public.shared_scrapes
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS token_hash TEXT,
  ADD COLUMN IF NOT EXISTS allow_download BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0 CHECK (access_count >= 0);

UPDATE public.shared_scrapes
SET expires_at = NOW() + INTERVAL '7 days'
WHERE expires_at IS NULL;

ALTER TABLE public.shared_scrapes
  ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '7 days'),
  ALTER COLUMN expires_at SET NOT NULL;

UPDATE public.shared_scrapes
SET token_hash = ENCODE(DIGEST(id, 'sha256'), 'hex')
WHERE token_hash IS NULL;

ALTER TABLE public.shared_scrapes
  ALTER COLUMN token_hash SET NOT NULL,
  ALTER COLUMN id SET DEFAULT (gen_random_uuid()::text);

-- Keep the migration safe to apply before the compatible application deploys:
-- the previous release supplies the raw token as id, and this trigger derives
-- its hash automatically during that short rollout window.
CREATE OR REPLACE FUNCTION public.set_shared_scrape_token_hash()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.token_hash IS NULL THEN
    NEW.token_hash := ENCODE(DIGEST(NEW.id, 'sha256'), 'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shared_scrapes_set_token_hash ON public.shared_scrapes;
CREATE TRIGGER shared_scrapes_set_token_hash
BEFORE INSERT ON public.shared_scrapes
FOR EACH ROW
EXECUTE FUNCTION public.set_shared_scrape_token_hash();

CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_scrapes_token_hash
  ON public.shared_scrapes(token_hash);

CREATE INDEX IF NOT EXISTS idx_shared_scrapes_team_scrape_created_at
  ON public.shared_scrapes(team_id, scrape_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shared_scrapes_expiry
  ON public.shared_scrapes(expires_at)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.record_shared_scrape_access(p_id TEXT)
RETURNS VOID
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.shared_scrapes
  SET
    last_accessed_at = NOW(),
    access_count = access_count + 1
  WHERE id = p_id;
$$;

REVOKE ALL ON FUNCTION public.record_shared_scrape_access(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_shared_scrape_access(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_talon_retention()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_shares INTEGER := 0;
  deleted_system_runs INTEGER := 0;
  deleted_audit_events INTEGER := 0;
  deleted_activity_events INTEGER := 0;
  deleted_rate_limits INTEGER := 0;
  deleted_scrape_jobs INTEGER := 0;
  scrubbed_share_ids INTEGER := 0;
BEGIN
  -- Remove legacy raw bearer tokens only after their new lifecycle has expired.
  -- Active legacy links retain rollback compatibility during the rollout.
  UPDATE public.shared_scrapes
  SET id = gen_random_uuid()::text
  WHERE id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND expires_at < NOW();
  GET DIAGNOSTICS scrubbed_share_ids = ROW_COUNT;

  DELETE FROM public.shared_scrapes
  WHERE
    (expires_at < NOW() - INTERVAL '30 days')
    OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '30 days');
  GET DIAGNOSTICS deleted_shares = ROW_COUNT;

  DELETE FROM public.system_runs
  WHERE started_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_system_runs = ROW_COUNT;

  DELETE FROM public.audit_events
  WHERE created_at < NOW() - INTERVAL '180 days';
  GET DIAGNOSTICS deleted_audit_events = ROW_COUNT;

  DELETE FROM public.activity_events
  WHERE created_at < NOW() - INTERVAL '180 days';
  GET DIAGNOSTICS deleted_activity_events = ROW_COUNT;

  DELETE FROM public.auth_rate_limits
  WHERE updated_at < NOW() - INTERVAL '30 days'
    AND (locked_until IS NULL OR locked_until < NOW());
  GET DIAGNOSTICS deleted_rate_limits = ROW_COUNT;

  -- Terminal jobs are operational history. Their contribution staging rows and
  -- events cascade with the job; completed scrape results remain intact.
  DELETE FROM public.scrape_jobs
  WHERE status IN ('succeeded', 'failed', 'canceled')
    AND updated_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS deleted_scrape_jobs = ROW_COUNT;

  RETURN JSONB_BUILD_OBJECT(
    'shares', deleted_shares,
    'scrubbedShareIds', scrubbed_share_ids,
    'systemRuns', deleted_system_runs,
    'auditEvents', deleted_audit_events,
    'activityEvents', deleted_activity_events,
    'rateLimits', deleted_rate_limits,
    'scrapeJobs', deleted_scrape_jobs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_talon_retention() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_talon_retention() TO service_role;
