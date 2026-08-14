import test from "node:test"
import assert from "node:assert/strict"
import {
  isScrapeJobCancellationRequested,
  planGitHubCooldownUntil,
  planScrapeJobFailure,
  planStaleScrapeJobRecovery,
} from "../lib/scrape-job-policy.ts"

const now = Date.parse("2026-08-13T12:00:00Z")
const currentRunAfter = "2026-08-13T11:59:00.000Z"

test("failed scrape jobs back off exponentially between attempts", () => {
  const firstRetry = planScrapeJobFailure({
    attempts: 1,
    maxAttempts: 3,
    currentRunAfter,
    now,
  })
  const secondRetry = planScrapeJobFailure({
    attempts: 2,
    maxAttempts: 3,
    currentRunAfter,
    now,
  })

  assert.deepEqual(firstRetry, {
    status: "queued",
    runAfter: "2026-08-13T12:02:00.000Z",
    retryDelayMs: 120_000,
  })
  assert.deepEqual(secondRetry, {
    status: "queued",
    runAfter: "2026-08-13T12:04:00.000Z",
    retryDelayMs: 240_000,
  })
})

test("GitHub retry-after controls worker scheduling with a one-minute floor", () => {
  const shortRateLimit = planScrapeJobFailure({
    attempts: 1,
    maxAttempts: 3,
    currentRunAfter,
    retryAfterMs: 15_000,
    now,
  })
  const longRateLimit = planScrapeJobFailure({
    attempts: 1,
    maxAttempts: 3,
    currentRunAfter,
    retryAfterMs: 7 * 60_000,
    now,
  })

  assert.equal(shortRateLimit.retryDelayMs, 60_000)
  assert.equal(shortRateLimit.runAfter, "2026-08-13T12:01:00.000Z")
  assert.equal(longRateLimit.retryDelayMs, 420_000)
  assert.equal(longRateLimit.runAfter, "2026-08-13T12:07:00.000Z")
})

test("retry exhaustion produces a terminal failure without moving run_after", () => {
  assert.deepEqual(
    planScrapeJobFailure({
      attempts: 3,
      maxAttempts: 3,
      currentRunAfter,
      retryAfterMs: 300_000,
      now,
    }),
    { status: "failed", runAfter: currentRunAfter, retryDelayMs: null }
  )
})

test("GitHub cooldown remains future-dated even when the source job exhausts retries", () => {
  assert.equal(planGitHubCooldownUntil(300_000, now), "2026-08-13T12:05:00.000Z")
  assert.equal(planGitHubCooldownUntil(5_000, now), "2026-08-13T12:01:00.000Z")
})

test("stale locks preserve the retry budget and eventually fail", () => {
  assert.equal(
    planStaleScrapeJobRecovery({ attempts: 1, maxAttempts: 3, cancelRequested: false }),
    "queued"
  )
  assert.equal(
    planStaleScrapeJobRecovery({ attempts: 3, maxAttempts: 3, cancelRequested: false }),
    "failed"
  )
})

test("cancellation takes precedence during stale-lock recovery and active steps", () => {
  assert.equal(
    planStaleScrapeJobRecovery({ attempts: 3, maxAttempts: 3, cancelRequested: true }),
    "canceled"
  )
  assert.equal(isScrapeJobCancellationRequested({ status: "running", cancel_requested: true }), true)
  assert.equal(isScrapeJobCancellationRequested({ status: "canceled", cancel_requested: false }), true)
  assert.equal(isScrapeJobCancellationRequested({ status: "running", cancel_requested: false }), false)
  assert.equal(isScrapeJobCancellationRequested(null), false)
})
