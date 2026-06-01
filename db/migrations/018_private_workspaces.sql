-- Private workspace defaults.
-- Existing data is not moved or deleted. Single-member teams are marked as
-- private so their existing records remain in place for that owner.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS owner_email TEXT,
  ADD COLUMN IF NOT EXISTS workspace_kind TEXT NOT NULL DEFAULT 'shared'
    CHECK (workspace_kind IN ('private', 'shared'));

UPDATE public.teams
SET owner_email = lower(trim(owner_email))
WHERE owner_email IS NOT NULL
  AND owner_email <> lower(trim(owner_email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_private_owner_email
  ON public.teams(lower(owner_email))
  WHERE workspace_kind = 'private' AND owner_email IS NOT NULL;

ALTER TABLE public.audit_events
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_events_team_created_at
  ON public.audit_events(team_id, created_at DESC);

WITH membership_counts AS (
  SELECT
    team_id,
    COUNT(*) AS member_count,
    MIN(lower(trim(email))) AS only_email
  FROM public.team_memberships
  GROUP BY team_id
)
UPDATE public.teams t
SET
  workspace_kind = 'private',
  owner_email = mc.only_email
FROM membership_counts mc
WHERE t.id = mc.team_id
  AND mc.member_count = 1
  AND t.owner_email IS NULL;

DO $$
DECLARE
  auth_user RECORD;
  normalized_email TEXT;
  display_name TEXT;
  workspace_id UUID;
  workspace_slug TEXT;
BEGIN
  FOR auth_user IN
    SELECT
      lower(trim(email)) AS email,
      raw_user_meta_data
    FROM auth.users
    WHERE email IS NOT NULL
  LOOP
    normalized_email := auth_user.email;
    display_name := COALESCE(
      NULLIF(trim(auth_user.raw_user_meta_data ->> 'display_name'), ''),
      NULLIF(trim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(trim(auth_user.raw_user_meta_data ->> 'name'), ''),
      split_part(normalized_email, '@', 1),
      'My'
    );

    SELECT id INTO workspace_id
    FROM public.teams
    WHERE workspace_kind = 'private'
      AND lower(owner_email) = normalized_email
    LIMIT 1;

    IF workspace_id IS NULL THEN
      workspace_slug := 'user-' || substr(md5(normalized_email), 1, 16);
      INSERT INTO public.teams (slug, name, owner_email, workspace_kind)
      VALUES (
        workspace_slug,
        CASE WHEN display_name = 'My' THEN 'My Workspace' ELSE display_name || '''s Workspace' END,
        normalized_email,
        'private'
      )
      ON CONFLICT (slug) DO UPDATE
      SET owner_email = EXCLUDED.owner_email,
          workspace_kind = 'private'
      RETURNING id INTO workspace_id;
    END IF;

    INSERT INTO public.team_memberships (team_id, email, display_name, role, invited_by)
    VALUES (workspace_id, normalized_email, display_name, 'owner', NULL)
    ON CONFLICT (team_id, email) DO UPDATE
    SET role = 'owner',
        display_name = COALESCE(public.team_memberships.display_name, EXCLUDED.display_name);
  END LOOP;
END $$;
