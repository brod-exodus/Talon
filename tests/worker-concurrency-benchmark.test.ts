import assert from "node:assert/strict"
import test from "node:test"
import { runWorkerConcurrencyBenchmark } from "../lib/worker-concurrency-benchmark.ts"

test("concurrent workers cannot claim one job more than once", () => {
  const result = runWorkerConcurrencyBenchmark()

  assert.equal(result.simultaneousClaim.workerCount, 3)
  assert.equal(result.simultaneousClaim.claimedJobIds.length, 1)
  assert.equal(result.simultaneousClaim.uniqueClaimCount, 1)
  assert.equal(result.simultaneousClaim.attempts, 1)
})

test("fair scheduling rotates workspaces and promotes aged background work", () => {
  const result = runWorkerConcurrencyBenchmark()

  assert.equal(new Set(result.fairness.workspaceOrder.slice(0, 3)).size, 3)
  assert.ok(result.fairness.agedBackgroundPosition > 0)
  assert.ok(result.fairness.agedBackgroundPosition <= 4)
})

test("stale lease recovery rejects the interrupted worker's late completion", () => {
  const result = runWorkerConcurrencyBenchmark()

  assert.equal(result.staleLease.recoveredJobs, 1)
  assert.equal(result.staleLease.staleCompletionRejected, true)
  assert.equal(result.staleLease.replacementCompletionApplied, true)
})

test("a shared GitHub cooldown blocks claims without consuming attempts", () => {
  const result = runWorkerConcurrencyBenchmark()

  assert.equal(result.githubCooldown.claimsWhileBlocked, 0)
  assert.equal(result.githubCooldown.attemptsWhileBlocked, 0)
  assert.equal(result.githubCooldown.claimAfterCooldown, true)
  assert.equal(result.passed, true)
})
