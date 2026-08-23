import test from "node:test"
import assert from "node:assert/strict"
import {
  CONTRIBUTOR_PROFILE_CACHE_TTL_MS,
  contributorProfileFreshAfter,
  estimateScrapeStepGitHubRequests,
  MAX_GITHUB_REQUESTS_PER_SCRAPE_STEP,
  planHydrationStep,
  planOrganizationDiscoveryStep,
  planOrganizationRepositoryPage,
  planRepositoryContributorPage,
  SCRAPE_HYDRATION_BATCH_SIZE,
  splitHydrationBatchByProfileCache,
} from "../lib/scrape-step.ts"

const candidates = Array.from({ length: 25 }, (_, index) => ({
  login: `user-${index + 1}`,
  contributions: 25 - index,
}))

test("planHydrationStep limits work and advances around persisted contributors", () => {
  const linked = new Set(["user-1", "user-2", "user-3"])
  const step = planHydrationStep(candidates, linked, 10)

  assert.equal(step.batch.length, 10)
  assert.equal(step.batch[0]?.login, "user-4")
  assert.equal(step.processedAfterStep, 13)
  assert.equal(step.completesHydration, false)
})

test("planHydrationStep marks the final resumable batch complete", () => {
  const linked = new Set(candidates.slice(0, 20).map((candidate) => candidate.login))
  const step = planHydrationStep(candidates, linked, 10)

  assert.equal(step.batch.length, 5)
  assert.equal(step.processedAfterStep, 25)
  assert.equal(step.completesHydration, true)
})

test("the default hydration batch keeps GitHub concurrency bounded at twenty profiles", () => {
  const step = planHydrationStep(candidates, new Set())

  assert.equal(SCRAPE_HYDRATION_BATCH_SIZE, 20)
  assert.equal(step.batch.length, 20)
  assert.equal(step.completesHydration, false)
})

test("worker request estimates distinguish discovery from worst-case cold hydration", () => {
  assert.equal(estimateScrapeStepGitHubRequests({ state: { phase: "discover" } }), 1)
  assert.equal(estimateScrapeStepGitHubRequests({ state: { phase: "hydrate" } }), 40)
  assert.equal(estimateScrapeStepGitHubRequests({ state: null }), 1)
  assert.equal(MAX_GITHUB_REQUESTS_PER_SCRAPE_STEP, 40)
})

test("hydration resumes idempotently across multiple worker invocations", () => {
  const largeCandidateSet = Array.from({ length: 55 }, (_, index) => ({
    login: `resume-user-${index + 1}`,
    contributions: 55 - index,
  }))
  const persisted = new Set<string>()
  const batches: string[][] = []

  for (let invocation = 0; invocation < 3; invocation++) {
    const step = planHydrationStep(largeCandidateSet, persisted, 20)
    const usernames = step.batch.map((candidate) => candidate.login)
    batches.push(usernames)
    usernames.forEach((username) => persisted.add(username))
  }

  assert.deepEqual(batches.map((batch) => batch.length), [20, 20, 15])
  assert.equal(new Set(batches.flat()).size, 55)
  assert.equal(persisted.size, 55)

  const replayedFinalStep = planHydrationStep(largeCandidateSet, persisted, 20)
  assert.deepEqual(replayedFinalStep.batch, [])
  assert.equal(replayedFinalStep.completesHydration, true)
})

test("profile cache planning refreshes only stale or missing contributors", () => {
  const batch = candidates.slice(0, 5)
  const plan = splitHydrationBatchByProfileCache(batch, new Set(["user-1", "user-3", "user-5"]))

  assert.deepEqual(plan.cached.map((candidate) => candidate.login), ["user-1", "user-3", "user-5"])
  assert.deepEqual(plan.refresh.map((candidate) => candidate.login), ["user-2", "user-4"])
})

test("contributor profile freshness uses a seven-day window", () => {
  const now = Date.parse("2026-08-14T12:00:00.000Z")

  assert.equal(CONTRIBUTOR_PROFILE_CACHE_TTL_MS, 7 * 24 * 60 * 60 * 1000)
  assert.equal(contributorProfileFreshAfter(now), "2026-08-07T12:00:00.000Z")
})

test("planOrganizationDiscoveryStep advances one repository step at a time", () => {
  assert.deepEqual(planOrganizationDiscoveryStep(3, 1), {
    repoIndex: 1,
    hasRepository: true,
    completesDiscovery: false,
    nextRepoIndex: 2,
  })
  assert.deepEqual(planOrganizationDiscoveryStep(3, 2), {
    repoIndex: 2,
    hasRepository: true,
    completesDiscovery: true,
    nextRepoIndex: 3,
  })
})

test("organization repository discovery advances one persisted GitHub page at a time", () => {
  assert.deepEqual(planOrganizationRepositoryPage(4, true), {
    scannedPage: 4,
    nextPage: 5,
    completesDiscovery: false,
  })
  assert.deepEqual(planOrganizationRepositoryPage(5, false), {
    scannedPage: 5,
    nextPage: 6,
    completesDiscovery: true,
  })
})

test("repository discovery advances one persisted GitHub page at a time", () => {
  assert.deepEqual(planRepositoryContributorPage(2, true), {
    scannedPage: 2,
    nextPage: 3,
    completesDiscovery: false,
  })
  assert.deepEqual(planRepositoryContributorPage(3, false), {
    scannedPage: 3,
    nextPage: 4,
    completesDiscovery: true,
  })
})

test("repository discovery normalizes an invalid initial page", () => {
  assert.deepEqual(planRepositoryContributorPage(0, true), {
    scannedPage: 1,
    nextPage: 2,
    completesDiscovery: false,
  })
})
