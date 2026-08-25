-- Provide an owner-facing, read-only inventory before any workspace export or
-- deletion capability exists. Counts are scoped by one explicit team id and do
-- not expose contributor, repository, membership, or operational row content.

SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.talon_schema_migrations
    WHERE version = 47 AND name = 'fair_scrape_job_scheduling'
  ) THEN
    RAISE EXCEPTION 'Talon migration 047 must be applied before migration 048';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.preview_workspace_lifecycle(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  preview JSONB;
BEGIN
  IF p_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teams WHERE id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Workspace not found' USING ERRCODE = '23503';
  END IF;

  SELECT JSONB_BUILD_OBJECT(
    'version', 1,
    'generatedAt', NOW(),
    'counts', JSONB_BUILD_OBJECT(
      'members', (SELECT COUNT(*) FROM public.team_memberships WHERE team_id = p_team_id),
      'authSessions', (SELECT COUNT(*) FROM public.auth_sessions WHERE team_id = p_team_id),
      'contributors', (SELECT COUNT(*) FROM public.contributors WHERE team_id = p_team_id),
      'scrapes', (SELECT COUNT(*) FROM public.scrapes WHERE team_id = p_team_id),
      'scrapeContributors', (SELECT COUNT(*) FROM public.scrape_contributors WHERE team_id = p_team_id),
      'sharedScrapes', (SELECT COUNT(*) FROM public.shared_scrapes WHERE team_id = p_team_id),
      'projects', (SELECT COUNT(*) FROM public.ecosystems WHERE team_id = p_team_id),
      'projectScrapes', (SELECT COUNT(*) FROM public.ecosystem_scrapes WHERE team_id = p_team_id),
      'projectCaches', (SELECT COUNT(*) FROM public.project_contributors_cache WHERE team_id = p_team_id),
      'projectLists', (SELECT COUNT(*) FROM public.project_lists WHERE team_id = p_team_id),
      'projectListContributors', (SELECT COUNT(*) FROM public.project_list_contributors WHERE team_id = p_team_id),
      'projectTracking', (SELECT COUNT(*) FROM public.project_contributor_tracking WHERE team_id = p_team_id),
      'watchedRepositories', (SELECT COUNT(*) FROM public.watched_repos WHERE team_id = p_team_id),
      'watchedContributors', (SELECT COUNT(*) FROM public.watched_repo_contributors WHERE team_id = p_team_id),
      'scrapeJobs', (SELECT COUNT(*) FROM public.scrape_jobs WHERE team_id = p_team_id),
      'scrapeJobContributions', (SELECT COUNT(*) FROM public.scrape_job_contributions WHERE team_id = p_team_id),
      'scrapeJobRepositoryContributions', (SELECT COUNT(*) FROM public.scrape_job_repository_contributions WHERE team_id = p_team_id),
      'scrapeJobEvents', (SELECT COUNT(*) FROM public.scrape_job_events WHERE team_id = p_team_id),
      'scrapeEnqueueRequests', (SELECT COUNT(*) FROM public.scrape_enqueue_requests WHERE team_id = p_team_id),
      'notificationDeliveries', (SELECT COUNT(*) FROM public.notification_deliveries WHERE team_id = p_team_id),
      'activityEvents', (SELECT COUNT(*) FROM public.activity_events WHERE team_id = p_team_id),
      'auditEvents', (SELECT COUNT(*) FROM public.audit_events WHERE team_id = p_team_id)
    ),
    'blockers', JSONB_BUILD_OBJECT(
      'activeScrapes', (SELECT COUNT(*) FROM public.scrapes WHERE team_id = p_team_id AND status = 'active'),
      'activeScrapeJobs', (SELECT COUNT(*) FROM public.scrape_jobs WHERE team_id = p_team_id AND status IN ('queued', 'running')),
      'activeNotificationDeliveries', (SELECT COUNT(*) FROM public.notification_deliveries WHERE team_id = p_team_id AND status IN ('queued', 'running')),
      'activeSharedLinks', (SELECT COUNT(*) FROM public.shared_scrapes WHERE team_id = p_team_id AND revoked_at IS NULL AND expires_at > NOW()),
      'activeAuthSessions', (SELECT COUNT(*) FROM public.auth_sessions WHERE team_id = p_team_id AND revoked_at IS NULL AND expires_at > NOW())
    )
  ) INTO preview;

  RETURN preview || JSONB_BUILD_OBJECT(
    'hasActiveWork',
    (preview #>> '{blockers,activeScrapes}')::BIGINT > 0
      OR (preview #>> '{blockers,activeScrapeJobs}')::BIGINT > 0
      OR (preview #>> '{blockers,activeNotificationDeliveries}')::BIGINT > 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_workspace_lifecycle(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_workspace_lifecycle(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_talon_lifecycle_contract_issues()
RETURNS TABLE(requirement_type TEXT, requirement_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT 'function'::TEXT, 'public.preview_workspace_lifecycle(uuid)'::TEXT
  WHERE to_regprocedure('public.preview_workspace_lifecycle(uuid)') IS NULL
  UNION ALL
  SELECT 'function_privilege'::TEXT, FORMAT('%s EXECUTE on public.preview_workspace_lifecycle(uuid) must be %s', required.role_name, required.allowed)
  FROM (VALUES
    ('service_role', TRUE),
    ('anon', FALSE),
    ('authenticated', FALSE)
  ) AS required(role_name, allowed)
  WHERE has_function_privilege(required.role_name, 'public.preview_workspace_lifecycle(uuid)', 'EXECUTE') IS DISTINCT FROM required.allowed
  ORDER BY 1, 2;
$$;

REVOKE ALL ON FUNCTION public.get_talon_lifecycle_contract_issues() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_talon_lifecycle_contract_issues() TO service_role;

DO $$
DECLARE
  first_issue RECORD;
BEGIN
  SELECT * INTO first_issue FROM public.get_talon_lifecycle_contract_issues() LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Talon lifecycle contract is incomplete: % %',
      first_issue.requirement_type, first_issue.requirement_name;
  END IF;
END $$;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (48, 'workspace_lifecycle_preview')
ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;
