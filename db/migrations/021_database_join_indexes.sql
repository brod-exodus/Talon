-- Additional join/filter indexes for high-growth Talon workspaces.
-- These are intentionally idempotent and match current application query shapes.

-- Dashboard and active scrape hydration fetch jobs for visible scrape ids within a team.
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_team_scrape_id
  ON public.scrape_jobs(team_id, scrape_id);

-- Admin/job history reads the latest scrape jobs for a team.
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_team_updated_at
  ON public.scrape_jobs(team_id, updated_at DESC);

-- Project and dashboard scrape cards map visible scrape ids back to Projects.
CREATE INDEX IF NOT EXISTS idx_ecosystem_scrapes_team_scrape_ecosystem
  ON public.ecosystem_scrapes(team_id, scrape_id, ecosystem_id);

-- Project detail/cache rebuilds list scrape ids for one Project inside a team.
CREATE INDEX IF NOT EXISTS idx_ecosystem_scrapes_team_ecosystem_scrape
  ON public.ecosystem_scrapes(team_id, ecosystem_id, scrape_id);

-- Contributor profiles read a contributor's source scrapes ordered by contribution volume.
CREATE INDEX IF NOT EXISTS idx_scrape_contributors_contributor_contributions
  ON public.scrape_contributors(contributor_id, contributions DESC, scrape_id);

-- Project tracking pages load the latest outreach rows for a team.
CREATE INDEX IF NOT EXISTS idx_project_contributor_tracking_team_updated
  ON public.project_contributor_tracking(team_id, updated_at DESC);

-- Pipeline filters by team/status and shows the freshest rows first.
CREATE INDEX IF NOT EXISTS idx_project_contributor_tracking_team_status_updated
  ON public.project_contributor_tracking(team_id, status, updated_at DESC);

-- Project tracking reads and upserts use the scoped Project/contributor pair.
CREATE INDEX IF NOT EXISTS idx_project_contributor_tracking_team_project_contributor
  ON public.project_contributor_tracking(team_id, ecosystem_id, contributor_id);

-- Follow-up queues filter due outreach rows and ignore archived/rejected statuses.
CREATE INDEX IF NOT EXISTS idx_project_contributor_tracking_team_followup_active
  ON public.project_contributor_tracking(team_id, next_follow_up_at, status)
  WHERE next_follow_up_at IS NOT NULL
    AND status <> 'archived'
    AND status <> 'rejected';

-- Project list management loads lists for one Project ordered by creation date.
CREATE INDEX IF NOT EXISTS idx_project_lists_team_ecosystem_created
  ON public.project_lists(team_id, ecosystem_id, created_at DESC);

-- List membership checks and inline save menus read contributor ids for visible lists.
CREATE INDEX IF NOT EXISTS idx_project_list_contributors_team_list_contributor
  ON public.project_list_contributors(team_id, project_list_id, contributor_id);

-- Contributor preview/list state checks which lists contain a contributor.
CREATE INDEX IF NOT EXISTS idx_project_list_contributors_team_contributor_list
  ON public.project_list_contributors(team_id, contributor_id, project_list_id);
