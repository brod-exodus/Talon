-- Export the recruiter-owned workspace state as one consistent, portable JSON
-- document. Operational histories, sessions, secret material, provider-owned
-- Auth/Storage data, and derived caches are deliberately excluded.

SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.talon_schema_migrations
    WHERE version = 48 AND name = 'workspace_lifecycle_preview'
  ) THEN
    RAISE EXCEPTION 'Talon migration 048 must be applied before migration 049';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.export_workspace_data(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_team_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.teams WHERE id = p_team_id
  ) THEN
    RAISE EXCEPTION 'Workspace not found' USING ERRCODE = '23503';
  END IF;

  SELECT JSONB_BUILD_OBJECT(
    'format', 'talon-workspace-export',
    'version', 1,
    'generatedAt', NOW(),
    'workspace', JSONB_BUILD_OBJECT('name', team.name, 'kind', team.workspace_kind),
    'data', JSONB_BUILD_OBJECT(
      'members', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', member.id, 'email', member.email, 'displayName', member.display_name,
          'role', member.role, 'createdAt', member.created_at
        ) ORDER BY member.created_at, member.id)
        FROM public.team_memberships AS member WHERE member.team_id = p_team_id
      ), '[]'::JSONB),
      'contributors', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', contributor.id, 'githubUsername', contributor.github_username,
          'name', contributor.name, 'avatarUrl', contributor.avatar_url,
          'bio', contributor.bio, 'location', contributor.location,
          'company', contributor.company, 'email', contributor.email,
          'twitter', contributor.twitter, 'linkedin', contributor.linkedin,
          'website', contributor.website, 'contacted', contributor.contacted,
          'contactedDate', contributor.contacted_date,
          'outreachNotes', contributor.outreach_notes,
          'outreachNotesUpdatedAt', contributor.outreach_notes_updated_at,
          'status', contributor.status, 'reminderNote', contributor.reminder_note,
          'reminderDate', contributor.reminder_date,
          'reminderUpdatedAt', contributor.reminder_updated_at,
          'createdAt', contributor.created_at, 'updatedAt', contributor.updated_at
        ) ORDER BY contributor.github_username, contributor.id)
        FROM public.contributors AS contributor WHERE contributor.team_id = p_team_id
      ), '[]'::JSONB),
      'scrapes', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', scrape.id, 'type', scrape.type, 'target', scrape.target,
          'status', scrape.status, 'progress', scrape.progress,
          'current', scrape.current, 'total', scrape.total,
          'startedAt', scrape.started_at, 'completedAt', scrape.completed_at,
          'minContributions', scrape.min_contributions,
          'contactInfoCount', scrape.contact_info_count,
          'totalContributors', scrape.total_contributors
        ) ORDER BY scrape.started_at, scrape.id)
        FROM public.scrapes AS scrape WHERE scrape.team_id = p_team_id
      ), '[]'::JSONB),
      'scrapeContributors', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'scrapeId', link.scrape_id, 'contributorId', link.contributor_id,
          'contributions', link.contributions
        ) ORDER BY link.scrape_id, link.contributor_id)
        FROM public.scrape_contributors AS link WHERE link.team_id = p_team_id
      ), '[]'::JSONB),
      'projects', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', project.id, 'name', project.name, 'createdAt', project.created_at
        ) ORDER BY project.created_at, project.id)
        FROM public.ecosystems AS project WHERE project.team_id = p_team_id
      ), '[]'::JSONB),
      'projectScrapes', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'projectId', link.ecosystem_id, 'scrapeId', link.scrape_id,
          'createdAt', link.created_at
        ) ORDER BY link.ecosystem_id, link.scrape_id)
        FROM public.ecosystem_scrapes AS link WHERE link.team_id = p_team_id
      ), '[]'::JSONB),
      'projectLists', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', list.id, 'projectId', list.ecosystem_id, 'name', list.name,
          'createdAt', list.created_at, 'updatedAt', list.updated_at
        ) ORDER BY list.created_at, list.id)
        FROM public.project_lists AS list WHERE list.team_id = p_team_id
      ), '[]'::JSONB),
      'projectListContributors', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'listId', item.project_list_id, 'contributorId', item.contributor_id,
          'createdAt', item.created_at
        ) ORDER BY item.project_list_id, item.contributor_id)
        FROM public.project_list_contributors AS item WHERE item.team_id = p_team_id
      ), '[]'::JSONB),
      'projectTracking', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', tracking.id, 'projectId', tracking.ecosystem_id,
          'contributorId', tracking.contributor_id, 'status', tracking.status,
          'notes', tracking.notes, 'lastContactedAt', tracking.last_contacted_at,
          'nextFollowUpAt', tracking.next_follow_up_at,
          'createdAt', tracking.created_at, 'updatedAt', tracking.updated_at
        ) ORDER BY tracking.created_at, tracking.id)
        FROM public.project_contributor_tracking AS tracking WHERE tracking.team_id = p_team_id
      ), '[]'::JSONB),
      'sharedLinks', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'scrapeId', share.scrape_id,
          'createdAt', share.created_at, 'expiresAt', share.expires_at,
          'revokedAt', share.revoked_at, 'allowDownload', share.allow_download,
          'lastAccessedAt', share.last_accessed_at, 'accessCount', share.access_count
        ) ORDER BY share.created_at, share.id)
        FROM public.shared_scrapes AS share WHERE share.team_id = p_team_id
      ), '[]'::JSONB),
      'watchedRepositories', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'id', watched.id, 'repository', watched.repo,
          'intervalHours', watched.interval_hours, 'active', watched.active,
          'lastCheckedAt', watched.last_checked_at, 'createdAt', watched.created_at
        ) ORDER BY watched.created_at, watched.id)
        FROM public.watched_repos AS watched WHERE watched.team_id = p_team_id
      ), '[]'::JSONB),
      'watchedContributors', COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
          'watchedRepositoryId', item.watched_repo_id,
          'githubUsername', item.github_username, 'firstSeenAt', item.first_seen_at,
          'detectedScrapeId', item.detected_scrape_id
        ) ORDER BY item.watched_repo_id, item.github_username)
        FROM public.watched_repo_contributors AS item WHERE item.team_id = p_team_id
      ), '[]'::JSONB)
    ),
    'excluded', JSONB_BUILD_ARRAY(
      'supabase_auth', 'profile_photo_storage', 'operational_history',
      'auth_sessions', 'derived_caches', 'encrypted_backups', 'secrets'
    )
  ) INTO result
  FROM public.teams AS team
  WHERE team.id = p_team_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.export_workspace_data(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_workspace_data(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.get_talon_lifecycle_contract_issues()
RETURNS TABLE(requirement_type TEXT, requirement_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT 'function'::TEXT, required.signature
  FROM (VALUES
    ('public.preview_workspace_lifecycle(uuid)'::TEXT),
    ('public.export_workspace_data(uuid)'::TEXT)
  ) AS required(signature)
  WHERE to_regprocedure(required.signature) IS NULL
  UNION ALL
  SELECT 'function_privilege'::TEXT,
    FORMAT('%s EXECUTE on %s must be %s', required.role_name, export_function.signature, required.allowed)
  FROM (VALUES
    ('public.preview_workspace_lifecycle(uuid)'::TEXT),
    ('public.export_workspace_data(uuid)'::TEXT)
  ) AS export_function(signature)
  CROSS JOIN (VALUES
    ('service_role', TRUE), ('anon', FALSE), ('authenticated', FALSE)
  ) AS required(role_name, allowed)
  WHERE has_function_privilege(required.role_name, export_function.signature, 'EXECUTE') IS DISTINCT FROM required.allowed
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
VALUES (49, 'workspace_data_export')
ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name;
