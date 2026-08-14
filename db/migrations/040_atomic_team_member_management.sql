-- Keep team ownership changes serialized and prevent concurrent requests from
-- demoting or removing the final application owner.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 39 AND name = 'notification_delivery_outbox'
  ) THEN
    RAISE EXCEPTION 'Talon migration 039 must be applied before migration 040';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.update_team_member_app_role(
  p_team_id UUID,
  p_member_id UUID,
  p_app_role TEXT
)
RETURNS SETOF public.team_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_member public.team_memberships%ROWTYPE;
  owner_count BIGINT;
BEGIN
  IF p_team_id IS NULL OR p_member_id IS NULL THEN
    RAISE EXCEPTION 'Team and member are required' USING ERRCODE = '22023';
  END IF;

  IF p_app_role IS NULL OR p_app_role NOT IN ('owner', 'admin', 'recruiter', 'viewer') THEN
    RAISE EXCEPTION 'Invalid application role' USING ERRCODE = '22023';
  END IF;

  -- Every member mutation for one team takes the same parent-row lock. This
  -- serializes otherwise independent membership rows before owner counting.
  PERFORM 1
  FROM public.teams AS team
  WHERE team.id = p_team_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT membership.*
  INTO target_member
  FROM public.team_memberships AS membership
  WHERE membership.id = p_member_id
    AND membership.team_id = p_team_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(target_member.app_role, target_member.role) = 'owner'
     AND p_app_role <> 'owner' THEN
    SELECT COUNT(*)
    INTO owner_count
    FROM public.team_memberships AS membership
    WHERE membership.team_id = p_team_id
      AND COALESCE(membership.app_role, membership.role) = 'owner';

    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'At least one owner must remain on the team'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.team_memberships AS membership
  SET app_role = p_app_role
  WHERE membership.id = p_member_id
    AND membership.team_id = p_team_id
  RETURNING membership.* INTO target_member;

  RETURN NEXT target_member;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_team_member(
  p_team_id UUID,
  p_member_id UUID
)
RETURNS SETOF public.team_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_member public.team_memberships%ROWTYPE;
  owner_count BIGINT;
BEGIN
  IF p_team_id IS NULL OR p_member_id IS NULL THEN
    RAISE EXCEPTION 'Team and member are required' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.teams AS team
  WHERE team.id = p_team_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT membership.*
  INTO target_member
  FROM public.team_memberships AS membership
  WHERE membership.id = p_member_id
    AND membership.team_id = p_team_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(target_member.app_role, target_member.role) = 'owner' THEN
    SELECT COUNT(*)
    INTO owner_count
    FROM public.team_memberships AS membership
    WHERE membership.team_id = p_team_id
      AND COALESCE(membership.app_role, membership.role) = 'owner';

    IF owner_count <= 1 THEN
      RAISE EXCEPTION 'At least one owner must remain on the team'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  DELETE FROM public.team_memberships AS membership
  WHERE membership.id = p_member_id
    AND membership.team_id = p_team_id
  RETURNING membership.* INTO target_member;

  RETURN NEXT target_member;
END;
$$;

REVOKE ALL ON FUNCTION public.update_team_member_app_role(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_team_member(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_team_member_app_role(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_team_member(UUID, UUID) TO service_role;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (40, 'atomic_team_member_management')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
