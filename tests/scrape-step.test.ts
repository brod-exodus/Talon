import test from "node:test"
import assert from "node:assert/strict"
import {
  planHydrationStep,
  planOrganizationDiscoveryStep,
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
