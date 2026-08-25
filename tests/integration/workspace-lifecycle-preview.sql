\set ON_ERROR_STOP on
\echo '[lifecycle-preview] verifying count isolation and active-work blockers'

BEGIN;

DO $$
DECLARE
  team_a CONSTANT UUID := '81000000-0000-4000-8000-000000000001';
  team_b CONSTANT UUID := '82000000-0000-4000-8000-000000000002';
  preview JSONB;
BEGIN
  INSERT INTO public.teams (id, slug, name)
  VALUES
    (team_a, 'lifecycle-preview-a', 'Lifecycle Preview A'),
    (team_b, 'lifecycle-preview-b', 'Lifecycle Preview B');

  INSERT INTO public.contributors (team_id, github_username, name)
  VALUES
    (team_a, 'lifecycle-preview-a-user', 'Preview A'),
    (team_b, 'lifecycle-preview-b-user', 'Preview B');

  INSERT INTO public.scrapes (id, team_id, type, target, status)
  VALUES
    ('lifecycle-preview-a', team_a, 'repository', 'public/preview-a', 'active'),
    ('lifecycle-preview-b', team_b, 'repository', 'public/preview-b', 'completed');

  preview := public.preview_workspace_lifecycle(team_a);

  IF (preview #>> '{counts,contributors}')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'lifecycle preview crossed the contributor workspace boundary';
  END IF;
  IF (preview #>> '{counts,scrapes}')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'lifecycle preview crossed the scrape workspace boundary';
  END IF;
  IF (preview #>> '{blockers,activeScrapes}')::INTEGER <> 1
    OR (preview ->> 'hasActiveWork')::BOOLEAN IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'lifecycle preview did not report active work';
  END IF;
  IF preview ? 'teamId' THEN
    RAISE EXCEPTION 'lifecycle preview exposed its workspace identifier';
  END IF;

  BEGIN
    PERFORM public.preview_workspace_lifecycle('83000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'missing workspace was accepted';
  EXCEPTION
    WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;

\echo '[lifecycle-preview] completed; fixture transaction rolled back'
