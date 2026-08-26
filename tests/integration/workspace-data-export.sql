\set ON_ERROR_STOP on
\echo '[workspace-export] verifying isolation, private recruiter data, and secret exclusions'

BEGIN;

DO $$
DECLARE
  team_a CONSTANT UUID := '91000000-0000-4000-8000-000000000001';
  team_b CONSTANT UUID := '92000000-0000-4000-8000-000000000002';
  contributor_a UUID;
  exported JSONB;
BEGIN
  INSERT INTO public.teams (id, slug, name)
  VALUES (team_a, 'workspace-export-a', 'Export A'), (team_b, 'workspace-export-b', 'Export B');

  INSERT INTO public.contributors (team_id, github_username, email, outreach_notes)
  VALUES (team_a, 'workspace-export-a-user', 'a@example.com', 'private recruiter note')
  RETURNING id INTO contributor_a;
  INSERT INTO public.contributors (team_id, github_username, email)
  VALUES (team_b, 'workspace-export-b-user', 'b@example.com');

  INSERT INTO public.scrapes (id, team_id, type, target, status)
  VALUES ('workspace-export-a', team_a, 'repository', 'public/export-a', 'completed');
  INSERT INTO public.scrape_contributors (team_id, scrape_id, contributor_id, contributions)
  VALUES (team_a, 'workspace-export-a', contributor_a, 7);

  exported := public.export_workspace_data(team_a);

  IF exported #>> '{format}' <> 'talon-workspace-export'
    OR (exported #>> '{version}')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'workspace export format contract is invalid';
  END IF;
  IF JSONB_ARRAY_LENGTH(exported #> '{data,contributors}') <> 1
    OR exported #>> '{data,contributors,0,githubUsername}' <> 'workspace-export-a-user' THEN
    RAISE EXCEPTION 'workspace export crossed the contributor workspace boundary';
  END IF;
  IF exported #>> '{data,contributors,0,outreachNotes}' <> 'private recruiter note' THEN
    RAISE EXCEPTION 'workspace export omitted recruiter-owned data';
  END IF;
  IF JSONB_ARRAY_LENGTH(exported #> '{data,scrapeContributors}') <> 1 THEN
    RAISE EXCEPTION 'workspace export omitted recruiter-owned relationships';
  END IF;
  IF exported::TEXT ~* '(team_id|teamId|token_hash|tokenHash)' THEN
    RAISE EXCEPTION 'workspace export exposed a forbidden internal field';
  END IF;

  BEGIN
    PERFORM public.export_workspace_data('93000000-0000-4000-8000-000000000003');
    RAISE EXCEPTION 'missing workspace was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;

\echo '[workspace-export] completed; fixture transaction rolled back'
