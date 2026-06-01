-- Split user-facing app roles from private workspace ownership.
-- Workspace membership role remains available for future workspace permissions,
-- while app_role drives Talon UI labels and app permissions.

ALTER TABLE public.team_memberships
  ADD COLUMN IF NOT EXISTS app_role TEXT
    CHECK (app_role IN ('owner', 'admin', 'recruiter', 'viewer'));

WITH role_sources AS (
  SELECT
    lower(trim(tm.email)) AS email,
    COALESCE(tm.app_role, tm.role) AS app_role,
    ROW_NUMBER() OVER (
      PARTITION BY lower(trim(tm.email))
      ORDER BY
        CASE WHEN t.workspace_kind = 'shared' THEN 0 ELSE 1 END,
        tm.created_at ASC
    ) AS rank
  FROM public.team_memberships tm
  JOIN public.teams t ON t.id = tm.team_id
),
preferred_roles AS (
  SELECT email, app_role
  FROM role_sources
  WHERE rank = 1
)
UPDATE public.team_memberships tm
SET app_role = pr.app_role
FROM preferred_roles pr
WHERE lower(trim(tm.email)) = pr.email
  AND tm.app_role IS NULL;

ALTER TABLE public.team_memberships
  ALTER COLUMN app_role SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_memberships_team_app_role
  ON public.team_memberships(team_id, app_role);
