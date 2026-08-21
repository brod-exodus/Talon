-- Make signed Talon sessions revocable before their twelve-hour token expiry.
-- The table stores only a keyed subject hash, never an email address or token.

SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 44 AND name = 'append_only_operational_history'
  ) THEN
    RAISE EXCEPTION 'Talon migration 044 must be applied before migration 045';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.auth_sessions (
  session_id UUID PRIMARY KEY,
  actor TEXT NOT NULL CHECK (actor IN ('admin', 'user')),
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  team_id UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT CHECK (revoke_reason IS NULL OR revoke_reason IN ('logout', 'password_change', 'operator')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_sessions_valid_lifetime CHECK (expires_at > issued_at),
  CONSTRAINT auth_sessions_actor_scope CHECK (
    (actor = 'admin' AND team_id IS NULL)
    OR (actor = 'user' AND team_id IS NOT NULL)
  ),
  CONSTRAINT auth_sessions_revocation_consistent CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_active_subject
  ON public.auth_sessions(subject_hash, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
  ON public.auth_sessions(expires_at);

ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.auth_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auth_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_talon_auth_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  deleted_sessions INTEGER := 0;
BEGIN
  DELETE FROM public.auth_sessions
  WHERE expires_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_sessions = ROW_COUNT;
  RETURN deleted_sessions;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_talon_auth_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_talon_auth_sessions() TO service_role;

CREATE OR REPLACE FUNCTION public.get_talon_session_contract_issues()
RETURNS TABLE(requirement_type TEXT, requirement_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH required_privileges(role_name, privilege_name, should_have) AS (
    VALUES
      ('service_role', 'SELECT', TRUE),
      ('service_role', 'INSERT', TRUE),
      ('service_role', 'UPDATE', TRUE),
      ('service_role', 'DELETE', TRUE),
      ('anon', 'SELECT', FALSE),
      ('anon', 'INSERT', FALSE),
      ('anon', 'UPDATE', FALSE),
      ('anon', 'DELETE', FALSE),
      ('authenticated', 'SELECT', FALSE),
      ('authenticated', 'INSERT', FALSE),
      ('authenticated', 'UPDATE', FALSE),
      ('authenticated', 'DELETE', FALSE)
  )
  SELECT 'table'::TEXT AS requirement_type, 'public.auth_sessions'::TEXT AS requirement_name
  WHERE to_regclass('public.auth_sessions') IS NULL
  UNION ALL
  SELECT 'row_level_security'::TEXT, 'public.auth_sessions'::TEXT
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'auth_sessions'
      AND relation.relrowsecurity
  )
  UNION ALL
  SELECT 'function'::TEXT, 'public.cleanup_talon_auth_sessions()'::TEXT
  WHERE to_regprocedure('public.cleanup_talon_auth_sessions()') IS NULL
  UNION ALL
  SELECT
    'table_privilege'::TEXT,
    format(
      '%s %s on public.auth_sessions must be %s',
      required.role_name,
      required.privilege_name,
      CASE WHEN required.should_have THEN 'granted' ELSE 'denied' END
    )::TEXT
  FROM required_privileges AS required
  WHERE has_table_privilege(required.role_name, 'public.auth_sessions', required.privilege_name)
    IS DISTINCT FROM required.should_have
  ORDER BY requirement_type, requirement_name;
$$;

REVOKE ALL ON FUNCTION public.get_talon_session_contract_issues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_talon_session_contract_issues() TO service_role;

DO $$
DECLARE
  first_issue RECORD;
BEGIN
  SELECT * INTO first_issue
  FROM public.get_talon_session_contract_issues()
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Talon session contract is incomplete: % %',
      first_issue.requirement_type,
      first_issue.requirement_name;
  END IF;
END $$;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (45, 'revocable_sessions')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
