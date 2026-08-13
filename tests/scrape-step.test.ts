import test from "node:test"
import assert from "node:assert/strict"
import {
  planHydrationStep,
  planOrganizationDiscoveryStep,
  planRepositoryContributorPage,
  SCRAPE_HYDRATION_BATCH_SIZE,
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
