-- Bound active sessions per keyed account subject. The trigger serializes
-- concurrent logins for the same subject, so parallel inserts cannot bypass
-- the limit or grow the registry without bound.

SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 45 AND name = 'revocable_sessions'
  ) THEN
    RAISE EXCEPTION 'Talon migration 045 must be applied before migration 046';
  END IF;
END $$;

ALTER TABLE public.auth_sessions
  DROP CONSTRAINT IF EXISTS auth_sessions_revoke_reason_check;

ALTER TABLE public.auth_sessions
  ADD CONSTRAINT auth_sessions_revoke_reason_check
  CHECK (
    revoke_reason IS NULL
    OR revoke_reason IN ('logout', 'password_change', 'operator', 'session_limit')
  );

-- Repair any pre-existing excess before enabling continuous enforcement.
WITH ranked_active_sessions AS (
  SELECT
    session_id,
    ROW_NUMBER() OVER (
      PARTITION BY subject_hash
      ORDER BY created_at DESC, issued_at DESC, session_id DESC
    ) AS subject_rank
  FROM public.auth_sessions
  WHERE revoked_at IS NULL
    AND expires_at > NOW()
)
UPDATE public.auth_sessions AS session
SET
  revoked_at = NOW(),
  revoke_reason = 'session_limit'
FROM ranked_active_sessions AS ranked
WHERE ranked.session_id = session.session_id
  AND ranked.subject_rank > 10;

CREATE OR REPLACE FUNCTION public.enforce_talon_active_session_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Transaction-scoped serialization keeps two simultaneous logins for one
  -- account from both observing a pre-insert count below the limit.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('talon-auth-sessions:' || NEW.subject_hash, 0)
  );

  WITH excess_sessions AS (
    SELECT session_id
    FROM public.auth_sessions
    WHERE subject_hash = NEW.subject_hash
      AND revoked_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC, issued_at DESC, session_id DESC
    OFFSET 10
    FOR UPDATE
  )
  UPDATE public.auth_sessions AS session
  SET
    revoked_at = NOW(),
    revoke_reason = 'session_limit'
  FROM excess_sessions AS excess
  WHERE session.session_id = excess.session_id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_talon_active_session_limit() FROM PUBLIC;

DROP TRIGGER IF EXISTS auth_sessions_enforce_active_limit ON public.auth_sessions;
CREATE TRIGGER auth_sessions_enforce_active_limit
AFTER INSERT ON public.auth_sessions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_talon_active_session_limit();

CREATE OR REPLACE FUNCTION public.get_talon_session_limit_contract_issues()
RETURNS TABLE(requirement_type TEXT, requirement_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    'function'::TEXT AS requirement_type,
    'public.enforce_talon_active_session_limit()'::TEXT AS requirement_name
  WHERE to_regprocedure('public.enforce_talon_active_session_limit()') IS NULL
  UNION ALL
  SELECT 'trigger'::TEXT, 'public.auth_sessions.auth_sessions_enforce_active_limit'::TEXT
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_record
    JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger_record.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'auth_sessions'
      AND trigger_record.tgname = 'auth_sessions_enforce_active_limit'
      AND trigger_record.tgenabled <> 'D'
      AND NOT trigger_record.tgisinternal
  )
  UNION ALL
  SELECT 'constraint'::TEXT, 'public.auth_sessions.auth_sessions_revoke_reason_check'::TEXT
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_record
    JOIN pg_catalog.pg_class AS relation ON relation.oid = constraint_record.conrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'auth_sessions'
      AND constraint_record.conname = 'auth_sessions_revoke_reason_check'
      AND constraint_record.convalidated
      AND pg_get_constraintdef(constraint_record.oid) LIKE '%session_limit%'
  )
  UNION ALL
  SELECT 'data_invariant'::TEXT, 'public.auth_sessions has more than 10 active sessions for a subject'::TEXT
  WHERE EXISTS (
    SELECT 1
    FROM public.auth_sessions
    WHERE revoked_at IS NULL
      AND expires_at > NOW()
    GROUP BY subject_hash
    HAVING COUNT(*) > 10
  )
  ORDER BY requirement_type, requirement_name;
$$;

REVOKE ALL ON FUNCTION public.get_talon_session_limit_contract_issues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_talon_session_limit_contract_issues() TO service_role;

DO $$
DECLARE
  first_issue RECORD;
BEGIN
  SELECT * INTO first_issue
  FROM public.get_talon_session_limit_contract_issues()
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Talon active-session limit contract is incomplete: % %',
      first_issue.requirement_type,
      first_issue.requirement_name;
  END IF;
END $$;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (46, 'bounded_active_sessions')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
