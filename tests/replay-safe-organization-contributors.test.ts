import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/033_replay_safe_organization_contributors.sql"),
  "utf8"
)
const runner = readFileSync(resolve(import.meta.dirname, "../lib/scrape-runner.ts"), "utf8")
const organizationStart = runner.indexOf("async function scrapeOrganization")
const organizationBody = runner.slice(organizationStart, runner.indexOf("async function scrapeRepository", organizationStart))

test("organization contribution pages use repository-scoped staging that follows job retention", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.scrape_job_repository_contributions/i)
  assert.match(migration, /job_id UUID NOT NULL REFERENCES public\.scrape_jobs\(id\) ON DELETE CASCADE/i)
  assert.match(migration, /PRIMARY KEY \(job_id, repository, github_login\)/i)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i)
  assert.match(migration, /REVOKE ALL ON TABLE public\.scrape_job_repository_contributions FROM anon, authenticated/i)
})

test("the atomic checkpoint rejects stale workers and stale page cursors before writing", () => {
  const lock = migration.indexOf("FOR UPDATE")
  const leaseGuard = migration.indexOf("current_job.status <> 'running'")
  const cursorGuard = migration.indexOf("Organization contributor checkpoint cursor is stale")
  const stagingWrite = migration.indexOf("INSERT INTO public.scrape_job_repository_contributions")

  assert.ok(lock > 0)
  assert.ok(leaseGuard > lock)
  assert.ok(cursorGuard > leaseGuard)
  assert.ok(stagingWrite > cursorGuard)
  assert.match(migration, /current_job\.locked_by IS DISTINCT FROM p_worker_id/i)
  assert.match(migration, /current_job\.cancel_requested/i)
  assert.match(migration, /current_page <> p_expected_page/i)
})

test("partial pages stay staged and only a final page updates visible aggregate totals", () => {
  const stagingWrite = migration.indexOf("INSERT INTO public.scrape_job_repository_contributions")
  const finalPageBranch = migration.indexOf("IF NOT p_has_next THEN")
  const aggregateWrite = migration.indexOf("INSERT INTO public.scrape_job_contributions", finalPageBranch)
  const stagingDelete = migration.indexOf("DELETE FROM public.scrape_job_repository_contributions", aggregateWrite)
  const branchEnd = migration.indexOf("END IF;", stagingDelete)

  assert.ok(stagingWrite > 0)
  assert.ok(finalPageBranch > stagingWrite)
  assert.ok(aggregateWrite > finalPageBranch)
  assert.ok(stagingDelete > aggregateWrite)
  assert.ok(branchEnd > stagingDelete)
  assert.match(
    migration.slice(aggregateWrite, branchEnd),
    /SET contributions = public\.scrape_job_contributions\.contributions \+ EXCLUDED\.contributions/i
  )
})

test("the contributor payload, cursor, progress, and event commit through one service-role function", () => {
  assert.match(migration, /JSONB_ARRAY_LENGTH\(p_contributions\) > 100/i)
  assert.match(migration, /SET state = next_state/i)
  assert.match(migration, /UPDATE public\.scrapes[\s\S]+current = calculated_next_repo_index/i)
  assert.match(migration, /'organization_contributor_page_scanned'/i)
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.checkpoint_organization_contributor_page[^;]+ FROM PUBLIC/i
  )
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.checkpoint_organization_contributor_page[^;]+ TO service_role/i
  )
  assert.match(migration, /VALUES \(33, 'replay_safe_organization_contributors'\)/i)
})

test("organization workers fetch and atomically checkpoint one contributor page per step", () => {
  assert.match(organizationBody, /getRepoContributorsPage\(repo, contributorPage\)/)
  assert.match(organizationBody, /checkpointOrganizationContributorPage\(job, \{/)
  assert.match(organizationBody, /page: page\.page/)
  assert.match(organizationBody, /hasNext: page\.hasNext/)
  assert.doesNotMatch(organizationBody, /getRepoContributors\(repo\)/)
  assert.doesNotMatch(organizationBody, /getScrapeJobContributionMap/)
})
