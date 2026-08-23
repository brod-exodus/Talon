import assert from "node:assert/strict"
import test from "node:test"
import {
  runCapacityScenario,
  runDefaultCapacityBenchmark,
} from "../lib/capacity-benchmark.ts"

test("capacity benchmark models repository discovery, hydration, and GitHub requests", () => {
  const result = runCapacityScenario({
    contributors: 400,
    firstClaimMs: 10_000,
    schedulerIntervalMs: 60_000,
    completionBudgetMs: 180_000,
  })

  assert.equal(result.discoveryPages, 4)
  assert.equal(result.hydrationBatches, 20)
  assert.equal(result.totalSteps, 24)
  assert.equal(result.workerInvocations, 1)
  assert.equal(result.githubRequests, 804)
  assert.equal(result.executionMs, 25_200)
  assert.equal(result.schedulerWaitMs, 10_000)
  assert.equal(result.estimatedCompletionMs, 35_200)
  assert.equal(result.withinBudget, true)
})

test("profile cache reuse lowers provider demand without changing durable checkpoints", () => {
  const cold = runCapacityScenario({ contributors: 1_000 })
  const warm = runCapacityScenario({ contributors: 1_000, cachedProfilePercent: 75 })

  assert.equal(cold.totalSteps, warm.totalSteps)
  assert.equal(cold.workerInvocations, warm.workerInvocations)
  assert.equal(cold.githubRequests, 2_010)
  assert.equal(warm.githubRequests, 510)
  assert.equal(warm.cachedProfiles, 750)
})

test("execution time budget starts a fresh invocation before the step cap", () => {
  const result = runCapacityScenario({
    contributors: 400,
    discoveryStepMs: 5_000,
    hydrationStepMs: 5_000,
    executionBudgetMs: 40_000,
    maxStepsPerInvocation: 20,
    firstClaimMs: 0,
  })

  assert.equal(result.totalSteps, 24)
  assert.equal(result.workerInvocations, 3)
})

test("default capacity scenarios stay inside their documented synthetic budgets", () => {
  const results = runDefaultCapacityBenchmark()

  assert.deepEqual(results.map((result) => result.contributors), [100, 400, 1_000, 5_000])
  assert.equal(results.every((result) => result.withinBudget), true)
})

test("capacity benchmark rejects misleading inputs", () => {
  assert.throws(() => runCapacityScenario({ contributors: 0 }), /positive number/)
  assert.throws(
    () => runCapacityScenario({ contributors: 100, cachedProfilePercent: 101 }),
    /between 0 and 100/
  )
})
