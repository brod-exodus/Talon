-- Make workspace isolation a database invariant for every high-value relation.
-- Existing application writes remain compatible: scrape_contributors receives
-- its team_id from the parent scrape when older insert paths omit the column.

-- Serialize Talon schema changes submitted from separate SQL Editor sessions.
-- The transaction-scoped lock is released automatically on commit or rollback.
SELECT pg_advisory_xact_lock(hashtextextended('talon-schema-migration', 0));

DO $$
DECLARE
  violation TEXT;
  missing_relation TEXT;
  required_migration TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.talon_schema_migrations
    WHERE version = 41 AND name = 'contactable_contributor_locations'
  ) THEN
    RAISE EXCEPTION 'Talon migration 041 must be applied before migration 042';
  END IF;

  SELECT requirement.relation_name, requirement.migration_version
  INTO missing_relation, required_migration
  FROM (
    VALUES
      ('public.scrapes', '001'),
      ('public.contributors', '001'),
      ('public.scrape_contributors', '001'),
      ('public.shared_scrapes', '001'),
      ('public.ecosystems', '001'),
      ('public.ecosystem_scrapes', '001'),
      ('public.watched_repos', '001'),
      ('public.watched_repo_contributors', '001'),
      ('public.scrape_jobs', '002'),
      ('public.scrape_job_contributions', '004'),
      ('public.scrape_job_events', '006'),
      ('public.project_contributors_cache', '013'),
      ('public.project_lists', '016'),
      ('public.project_list_contributors', '016'),
      ('public.project_contributor_tracking', '017'),
      ('public.scrape_enqueue_requests', '028'),
      ('public.scrape_job_repository_contributions', '033')
  ) AS requirement(relation_name, migration_version)
  WHERE to_regclass(requirement.relation_name) IS NULL
  ORDER BY requirement.migration_version
  LIMIT 1;

  IF missing_relation IS NOT NULL THEN
    RAISE EXCEPTION 'Required table % is missing. Apply migration % before migration 042',
      missing_relation,
      required_migration
      USING ERRCODE = '42P01';
  END IF;

  SELECT relation
  INTO violation
  FROM (
    SELECT 'scrape_contributors -> scrapes/contributors' AS relation
    FROM public.scrape_contributors AS link
    JOIN public.scrapes AS scrape ON scrape.id = link.scrape_id
    JOIN public.contributors AS contributor ON contributor.id = link.contributor_id
    WHERE scrape.team_id IS DISTINCT FROM contributor.team_id

    UNION ALL

    SELECT 'scrape_jobs -> scrapes'
    FROM public.scrape_jobs AS job
    JOIN public.scrapes AS scrape ON scrape.id = job.scrape_id
    WHERE job.team_id IS DISTINCT FROM scrape.team_id

    UNION ALL

    SELECT 'scrape_job_contributions -> scrape_jobs'
    FROM public.scrape_job_contributions AS contribution
    JOIN public.scrape_jobs AS job ON job.id = contribution.job_id
    WHERE contribution.team_id IS DISTINCT FROM job.team_id

    UNION ALL

    SELECT 'scrape_job_events -> scrape_jobs/scrapes'
    FROM public.scrape_job_events AS event
    LEFT JOIN public.scrape_jobs AS job ON job.id = event.job_id
    LEFT JOIN public.scrapes AS scrape ON scrape.id = event.scrape_id
    WHERE (event.job_id IS NOT NULL AND event.team_id IS DISTINCT FROM job.team_id)
       OR (event.scrape_id IS NOT NULL AND event.team_id IS DISTINCT FROM scrape.team_id)
       OR (event.job_id IS NOT NULL AND event.scrape_id IS NOT NULL AND event.scrape_id IS DISTINCT FROM job.scrape_id)

    UNION ALL

    SELECT 'shared_scrapes -> scrapes'
    FROM public.shared_scrapes AS share
    JOIN public.scrapes AS scrape ON scrape.id = share.scrape_id
    WHERE share.team_id IS DISTINCT FROM scrape.team_id

    UNION ALL

    SELECT 'ecosystem_scrapes -> ecosystems/scrapes'
    FROM public.ecosystem_scrapes AS link
    JOIN public.ecosystems AS ecosystem ON ecosystem.id = link.ecosystem_id
    JOIN public.scrapes AS scrape ON scrape.id = link.scrape_id
    WHERE link.team_id IS DISTINCT FROM ecosystem.team_id
       OR link.team_id IS DISTINCT FROM scrape.team_id

    UNION ALL

    SELECT 'project_contributors_cache -> ecosystems'
    FROM public.project_contributors_cache AS cache
    JOIN public.ecosystems AS ecosystem ON ecosystem.id = cache.ecosystem_id
    WHERE cache.team_id IS DISTINCT FROM ecosystem.team_id

    UNION ALL

    SELECT 'project_lists -> ecosystems'
    FROM public.project_lists AS list
    JOIN public.ecosystems AS ecosystem ON ecosystem.id = list.ecosystem_id
    WHERE list.team_id IS DISTINCT FROM ecosystem.team_id

    UNION ALL

    SELECT 'project_list_contributors -> lists/contributors'
    FROM public.project_list_contributors AS item
    JOIN public.project_lists AS list ON list.id = item.project_list_id
    JOIN public.contributors AS contributor ON contributor.id = item.contributor_id
    WHERE item.team_id IS DISTINCT FROM list.team_id
       OR item.team_id IS DISTINCT FROM contributor.team_id

    UNION ALL

    SELECT 'project_contributor_tracking -> ecosystems/contributors'
    FROM public.project_contributor_tracking AS tracking
    JOIN public.ecosystems AS ecosystem ON ecosystem.id = tracking.ecosystem_id
    JOIN public.contributors AS contributor ON contributor.id = tracking.contributor_id
    WHERE tracking.team_id IS DISTINCT FROM ecosystem.team_id
       OR tracking.team_id IS DISTINCT FROM contributor.team_id

    UNION ALL

    SELECT 'scrape_enqueue_requests -> scrape_jobs/scrapes'
    FROM public.scrape_enqueue_requests AS request
    JOIN public.scrape_jobs AS job ON job.id = request.job_id
    JOIN public.scrapes AS scrape ON scrape.id = request.scrape_id
    WHERE request.team_id IS DISTINCT FROM job.team_id
       OR request.team_id IS DISTINCT FROM scrape.team_id
       OR request.scrape_id IS DISTINCT FROM job.scrape_id

    UNION ALL

    SELECT 'scrape_job_repository_contributions -> scrape_jobs'
    FROM public.scrape_job_repository_contributions AS contribution
    JOIN public.scrape_jobs AS job ON job.id = contribution.job_id
    WHERE contribution.team_id IS DISTINCT FROM job.team_id

    UNION ALL

    SELECT 'scrapes -> watched_repos'
    FROM public.scrapes AS scrape
    JOIN public.watched_repos AS watched ON watched.id = scrape.watched_repo_id
    WHERE scrape.team_id IS DISTINCT FROM watched.team_id

    UNION ALL

    SELECT 'watched_repo_contributors -> watched_repos/scrapes'
    FROM public.watched_repo_contributors AS contributor
    JOIN public.watched_repos AS watched ON watched.id = contributor.watched_repo_id
    LEFT JOIN public.scrapes AS scrape ON scrape.id = contributor.detected_scrape_id
    WHERE contributor.team_id IS DISTINCT FROM watched.team_id
       OR (contributor.detected_scrape_id IS NOT NULL AND contributor.team_id IS DISTINCT FROM scrape.team_id)
  ) AS violations
  LIMIT 1;

  IF violation IS NOT NULL THEN
    RAISE EXCEPTION 'Workspace referential-integrity violation found in %', violation
      USING ERRCODE = '23514';
  END IF;
END $$;

-- Drop only constraints owned by this migration so a retry after an interrupted
-- manual SQL Editor run is safe.
ALTER TABLE public.scrape_contributors DROP CONSTRAINT IF EXISTS scrape_contributors_team_scrape_fkey;
ALTER TABLE public.scrape_contributors DROP CONSTRAINT IF EXISTS scrape_contributors_team_contributor_fkey;
ALTER TABLE public.scrape_jobs DROP CONSTRAINT IF EXISTS scrape_jobs_team_scrape_fkey;
ALTER TABLE public.scrape_job_contributions DROP CONSTRAINT IF EXISTS scrape_job_contributions_team_job_fkey;
ALTER TABLE public.scrape_job_events DROP CONSTRAINT IF EXISTS scrape_job_events_team_job_fkey;
ALTER TABLE public.scrape_job_events DROP CONSTRAINT IF EXISTS scrape_job_events_team_scrape_fkey;
ALTER TABLE public.scrape_job_events DROP CONSTRAINT IF EXISTS scrape_job_events_team_job_scrape_fkey;
ALTER TABLE public.shared_scrapes DROP CONSTRAINT IF EXISTS shared_scrapes_team_scrape_fkey;
ALTER TABLE public.ecosystem_scrapes DROP CONSTRAINT IF EXISTS ecosystem_scrapes_team_ecosystem_fkey;
ALTER TABLE public.ecosystem_scrapes DROP CONSTRAINT IF EXISTS ecosystem_scrapes_team_scrape_fkey;
ALTER TABLE public.project_contributors_cache DROP CONSTRAINT IF EXISTS project_contributors_cache_team_ecosystem_fkey;
ALTER TABLE public.project_lists DROP CONSTRAINT IF EXISTS project_lists_team_ecosystem_fkey;
ALTER TABLE public.project_list_contributors DROP CONSTRAINT IF EXISTS project_list_contributors_team_list_fkey;
ALTER TABLE public.project_list_contributors DROP CONSTRAINT IF EXISTS project_list_contributors_team_contributor_fkey;
ALTER TABLE public.project_contributor_tracking DROP CONSTRAINT IF EXISTS project_contributor_tracking_team_ecosystem_fkey;
ALTER TABLE public.project_contributor_tracking DROP CONSTRAINT IF EXISTS project_contributor_tracking_team_contributor_fkey;
ALTER TABLE public.scrape_enqueue_requests DROP CONSTRAINT IF EXISTS scrape_enqueue_requests_team_job_scrape_fkey;
ALTER TABLE public.scrape_job_repository_contributions DROP CONSTRAINT IF EXISTS scrape_job_repository_contributions_team_job_fkey;
ALTER TABLE public.scrapes DROP CONSTRAINT IF EXISTS scrapes_team_watched_repo_fkey;
ALTER TABLE public.watched_repo_contributors DROP CONSTRAINT IF EXISTS watched_repo_contributors_team_watched_repo_fkey;
ALTER TABLE public.watched_repo_contributors DROP CONSTRAINT IF EXISTS watched_repo_contributors_team_detected_scrape_fkey;

ALTER TABLE public.scrapes DROP CONSTRAINT IF EXISTS scrapes_team_id_id_key;
ALTER TABLE public.contributors DROP CONSTRAINT IF EXISTS contributors_team_id_id_key;
ALTER TABLE public.ecosystems DROP CONSTRAINT IF EXISTS ecosystems_team_id_id_key;
ALTER TABLE public.scrape_jobs DROP CONSTRAINT IF EXISTS scrape_jobs_team_id_id_key;
ALTER TABLE public.scrape_jobs DROP CONSTRAINT IF EXISTS scrape_jobs_team_id_id_scrape_id_key;
ALTER TABLE public.project_lists DROP CONSTRAINT IF EXISTS project_lists_team_id_id_key;
ALTER TABLE public.watched_repos DROP CONSTRAINT IF EXISTS watched_repos_team_id_id_key;

ALTER TABLE public.scrapes
  ADD CONSTRAINT scrapes_team_id_id_key UNIQUE (team_id, id);
ALTER TABLE public.contributors
  ADD CONSTRAINT contributors_team_id_id_key UNIQUE (team_id, id);
ALTER TABLE public.ecosystems
  ADD CONSTRAINT ecosystems_team_id_id_key UNIQUE (team_id, id);
ALTER TABLE public.scrape_jobs
  ADD CONSTRAINT scrape_jobs_team_id_id_key UNIQUE (team_id, id),
  ADD CONSTRAINT scrape_jobs_team_id_id_scrape_id_key UNIQUE (team_id, id, scrape_id);
ALTER TABLE public.project_lists
  ADD CONSTRAINT project_lists_team_id_id_key UNIQUE (team_id, id);
ALTER TABLE public.watched_repos
  ADD CONSTRAINT watched_repos_team_id_id_key UNIQUE (team_id, id);

ALTER TABLE public.scrape_contributors
  ADD COLUMN IF NOT EXISTS team_id UUID;

UPDATE public.scrape_contributors AS link
SET team_id = scrape.team_id
FROM public.scrapes AS scrape
WHERE scrape.id = link.scrape_id
  AND link.team_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_scrape_contributor_team_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.team_id IS NULL THEN
    SELECT scrape.team_id
    INTO NEW.team_id
    FROM public.scrapes AS scrape
    WHERE scrape.id = NEW.scrape_id;
  END IF;

  IF NEW.team_id IS NULL THEN
    RAISE EXCEPTION 'Scrape contributor parent scrape does not exist'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_scrape_contributor_team_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_scrape_contributor_team_id() TO service_role;

DROP TRIGGER IF EXISTS scrape_contributors_set_team_id ON public.scrape_contributors;
CREATE TRIGGER scrape_contributors_set_team_id
BEFORE INSERT OR UPDATE OF scrape_id, team_id
ON public.scrape_contributors
FOR EACH ROW
EXECUTE FUNCTION public.set_scrape_contributor_team_id();

ALTER TABLE public.scrape_contributors
  ALTER COLUMN team_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_scrape_contributors_team_scrape
  ON public.scrape_contributors(team_id, scrape_id, contributions DESC);

ALTER TABLE public.scrape_contributors
  ADD CONSTRAINT scrape_contributors_team_scrape_fkey
    FOREIGN KEY (team_id, scrape_id)
    REFERENCES public.scrapes(team_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT scrape_contributors_team_contributor_fkey
    FOREIGN KEY (team_id, contributor_id)
    REFERENCES public.contributors(team_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.scrape_jobs
  ADD CONSTRAINT scrape_jobs_team_scrape_fkey
    FOREIGN KEY (team_id, scrape_id)
    REFERENCES public.scrapes(team_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.scrape_job_contributions
  ADD CONSTRAINT scrape_job_contributions_team_job_fkey
    FOREIGN KEY (team_id, job_id)
    REFERENCES public.scrape_jobs(team_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.scrape_job_events
  ADD CONSTRAINT scrape_job_events_team_job_fkey
    FOREIGN KEY (team_id, job_id)
    REFERENCES public.scrape_jobs(team_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT scrape_job_events_team_scrape_fkey
    FOREIGN KEY (team_id, scrape_id)
    REFERENCES public.scrapes(team_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT scrape_job_events_team_job_scrape_fkey
    FOREIGN KEY (team_id, job_id, scrape_id)
    REFERENCES public.scrape_jobs(team_id, id, scrape_id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.shared_scrapes
  ADD CONSTRAINT shared_scrapes_team_scrape_fkey
    FOREIGN KEY (team_id, scrape_id)
    REFERENCES public.scrapes(team_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.ecosystem_scrapes
  ADD CONSTRAINT ecosystem_scrapes_team_ecosystem_fkey
    FOREIGN KEY (team_id, ecosystem_id)
    REFERENCES public.ecosystems(team_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT ecosystem_scrapes_team_scrape_fkey
    FOREIGN KEY (team_id, scrape_id)
    REFERENCES public.scrapes(team_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.project_contributors_cache
  ADD CONSTRAINT project_contributors_cache_team_ecosystem_fkey
    FOREIGN KEY (team_id, ecosystem_id)
    REFERENCES public.ecosystems(team_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.project_lists
  ADD CONSTRAINT project_lists_team_ecosystem_fkey
    FOREIGN KEY (team_id, ecosystem_id)
    REFERENCES public.ecosystems(team_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.project_list_contributors
  ADD CONSTRAINT project_list_contributors_team_list_fkey
    FOREIGN KEY (team_id, project_list_id)
    REFERENCES public.project_lists(team_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT project_list_contributors_team_contributor_fkey
    FOREIGN KEY (team_id, contributor_id)
    REFERENCES public.contributors(team_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.project_contributor_tracking
  ADD CONSTRAINT project_contributor_tracking_team_ecosystem_fkey
    FOREIGN KEY (team_id, ecosystem_id)
    REFERENCES public.ecosystems(team_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT project_contributor_tracking_team_contributor_fkey
    FOREIGN KEY (team_id, contributor_id)
    REFERENCES public.contributors(team_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.scrape_enqueue_requests
  ADD CONSTRAINT scrape_enqueue_requests_team_job_scrape_fkey
    FOREIGN KEY (team_id, job_id, scrape_id)
    REFERENCES public.scrape_jobs(team_id, id, scrape_id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.scrape_job_repository_contributions
  ADD CONSTRAINT scrape_job_repository_contributions_team_job_fkey
    FOREIGN KEY (team_id, job_id)
    REFERENCES public.scrape_jobs(team_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.scrapes
  ADD CONSTRAINT scrapes_team_watched_repo_fkey
    FOREIGN KEY (team_id, watched_repo_id)
    REFERENCES public.watched_repos(team_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.watched_repo_contributors
  ADD CONSTRAINT watched_repo_contributors_team_watched_repo_fkey
    FOREIGN KEY (team_id, watched_repo_id)
    REFERENCES public.watched_repos(team_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT watched_repo_contributors_team_detected_scrape_fkey
    FOREIGN KEY (team_id, detected_scrape_id)
    REFERENCES public.scrapes(team_id, id)
    DEFERRABLE INITIALLY IMMEDIATE
    NOT VALID;

ALTER TABLE public.scrape_contributors VALIDATE CONSTRAINT scrape_contributors_team_scrape_fkey;
ALTER TABLE public.scrape_contributors VALIDATE CONSTRAINT scrape_contributors_team_contributor_fkey;
ALTER TABLE public.scrape_jobs VALIDATE CONSTRAINT scrape_jobs_team_scrape_fkey;
ALTER TABLE public.scrape_job_contributions VALIDATE CONSTRAINT scrape_job_contributions_team_job_fkey;
ALTER TABLE public.scrape_job_events VALIDATE CONSTRAINT scrape_job_events_team_job_fkey;
ALTER TABLE public.scrape_job_events VALIDATE CONSTRAINT scrape_job_events_team_scrape_fkey;
ALTER TABLE public.scrape_job_events VALIDATE CONSTRAINT scrape_job_events_team_job_scrape_fkey;
ALTER TABLE public.shared_scrapes VALIDATE CONSTRAINT shared_scrapes_team_scrape_fkey;
ALTER TABLE public.ecosystem_scrapes VALIDATE CONSTRAINT ecosystem_scrapes_team_ecosystem_fkey;
ALTER TABLE public.ecosystem_scrapes VALIDATE CONSTRAINT ecosystem_scrapes_team_scrape_fkey;
ALTER TABLE public.project_contributors_cache VALIDATE CONSTRAINT project_contributors_cache_team_ecosystem_fkey;
ALTER TABLE public.project_lists VALIDATE CONSTRAINT project_lists_team_ecosystem_fkey;
ALTER TABLE public.project_list_contributors VALIDATE CONSTRAINT project_list_contributors_team_list_fkey;
ALTER TABLE public.project_list_contributors VALIDATE CONSTRAINT project_list_contributors_team_contributor_fkey;
ALTER TABLE public.project_contributor_tracking VALIDATE CONSTRAINT project_contributor_tracking_team_ecosystem_fkey;
ALTER TABLE public.project_contributor_tracking VALIDATE CONSTRAINT project_contributor_tracking_team_contributor_fkey;
ALTER TABLE public.scrape_enqueue_requests VALIDATE CONSTRAINT scrape_enqueue_requests_team_job_scrape_fkey;
ALTER TABLE public.scrape_job_repository_contributions VALIDATE CONSTRAINT scrape_job_repository_contributions_team_job_fkey;
ALTER TABLE public.scrapes VALIDATE CONSTRAINT scrapes_team_watched_repo_fkey;
ALTER TABLE public.watched_repo_contributors VALIDATE CONSTRAINT watched_repo_contributors_team_watched_repo_fkey;
ALTER TABLE public.watched_repo_contributors VALIDATE CONSTRAINT watched_repo_contributors_team_detected_scrape_fkey;

INSERT INTO public.talon_schema_migrations (version, name)
VALUES (42, 'workspace_referential_integrity')
ON CONFLICT (version) DO UPDATE
SET name = EXCLUDED.name;
