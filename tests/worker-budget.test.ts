import test from "node:test"
import assert from "node:assert/strict"
import { runBoundedJobSteps } from "../lib/worker-budget.ts"

test("runBoundedJobSteps refreshes persisted state until the job completes", async () => {
  const seen: number[] = []
  const result = await runBoundedJobSteps({
    initialJob: { step: 0 },
    runStep: async (job) => {
      seen.push(job.step)
      return job.step === 2
    },
    refreshJob: async (job) => ({ step: job.step + 1 }),
    budgetMs: 1000,
    maxSteps: 10,
  })

  assert.deepEqual(seen, [0, 1, 2])
  assert.equal(result.completed, true)
  assert.equal(result.steps, 3)
})

test("runBoundedJobSteps yields after the configured step limit", async () => {
  const result = await runBoundedJobSteps({
    initialJob: { step: 0 },
    runStep: async () => false,
    refreshJob: async (job) => ({ step: job.step + 1 }),
    budgetMs: 1000,
    maxSteps: 4,
  })

  assert.equal(result.completed, false)
  assert.equal(result.steps, 4)
})

test("runBoundedJobSteps yields once the execution budget is exhausted", async () => {
  let clock = 0
  const result = await runBoundedJobSteps({
    initialJob: { step: 0 },
    runStep: async () => {
      clock += 600
      return false
    },
    refreshJob: async (job) => ({ step: job.step + 1 }),
    budgetMs: 500,
    maxSteps: 10,
    now: () => clock,
  })

  assert.equal(result.completed, false)
  assert.equal(result.steps, 1)
  assert.equal(result.elapsedMs, 600)
})

test("runBoundedJobSteps stops before exceeding a weighted provider budget", async () => {
  const seen: number[] = []
  const result = await runBoundedJobSteps({
    initialJob: { step: 0, cost: 1 },
    runStep: async (job) => {
      seen.push(job.step)
      return false
    },
    refreshJob: async (job) => ({ step: job.step + 1, cost: 40 }),
    getStepCost: (job) => job.cost,
    costBudget: 81,
    maxSteps: 100,
  })

  assert.deepEqual(seen, [0, 1, 2])
  assert.equal(result.completed, false)
  assert.equal(result.steps, 3)
  assert.equal(result.cost, 81)
  assert.equal(result.limit, "cost")
})
