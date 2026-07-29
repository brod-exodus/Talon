CREATE TABLE IF NOT EXISTS public.system_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('keepalive', 'scrape_worker', 'watched_repos')),
  status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failure')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_system_runs_kind_started_at
  ON public.system_runs(kind, started_at DESC);

ALTER TABLE public.system_runs ENABLE ROW LEVEL SECURITY;

-- No user-facing policies are intentional. Only service-role server routes may
-- read or write operational run history.
