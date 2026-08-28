\set ON_ERROR_STOP on
\echo '[workspace-deletion] verifying isolation, blockers, cascades, and receipt privacy'

DO $$
DECLARE
  team_a UUID := gen_random_uuid();
  team_b UUID := gen_random_uuid();
  receipt JSONB;
  cleanup_id UUID;
BEGIN
  INSERT INTO public.teams (id, slug, name)
  VALUES (team_a, 'delete-a', 'Delete A'), (team_b, 'keep-b', 'Keep B');
  INSERT INTO public.team_memberships (team_id, email, role, app_role, avatar_path)
  VALUES (team_a, 'delete@example.com', 'owner', 'owner', team_a::TEXT || '/avatar.png'), (team_b, 'keep@example.com', 'owner', 'owner', NULL);
  INSERT INTO public.scrapes (id, team_id, type, target, status)
  VALUES ('delete-scrape', team_a, 'repository', 'public/delete', 'active');

  BEGIN
    PERFORM public.delete_workspace_data(team_a, 'delete-a');
    RAISE EXCEPTION 'active workspace deletion unexpectedly succeeded';
  EXCEPTION WHEN object_in_use THEN
    NULL;
  END;

  UPDATE public.scrapes SET status = 'completed' WHERE id = 'delete-scrape';
  receipt := public.delete_workspace_data(team_a, 'delete-a');

  IF EXISTS (SELECT 1 FROM public.teams WHERE id = team_a)
    OR EXISTS (SELECT 1 FROM public.scrapes WHERE team_id = team_a)
    OR EXISTS (SELECT 1 FROM public.team_memberships WHERE team_id = team_a) THEN
    RAISE EXCEPTION 'workspace-owned rows survived deletion';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = team_b) THEN
    RAISE EXCEPTION 'workspace deletion crossed the team boundary';
  END IF;
  IF receipt ? 'teamId' OR receipt ? 'slug' THEN
    RAISE EXCEPTION 'deletion receipt exposed a workspace identifier';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_events
    WHERE id = (receipt->>'receiptId')::UUID
      AND team_id IS NULL
      AND metadata ? 'receiptVersion'
  ) THEN
    RAISE EXCEPTION 'anonymous deletion receipt was not preserved';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.storage_cleanup_tasks
    WHERE id = (receipt->>'receiptId')::UUID
      AND status = 'queued'
      AND object_paths = jsonb_build_array(team_a::TEXT || '/avatar.png')
  ) THEN
    RAISE EXCEPTION 'durable storage cleanup was not created atomically';
  END IF;

  cleanup_id := (receipt->>'receiptId')::UUID;
  PERFORM 1
  FROM public.claim_storage_cleanup_task('workspace-deletion-test', cleanup_id);
  IF NOT public.complete_storage_cleanup_task(cleanup_id, 'workspace-deletion-test') THEN
    RAISE EXCEPTION 'active cleanup lease could not complete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.storage_cleanup_tasks
    WHERE id = cleanup_id
      AND status = 'succeeded'
      AND object_paths = '[]'::JSONB
  ) THEN
    RAISE EXCEPTION 'successful storage cleanup retained deleted object paths';
  END IF;
END $$;
