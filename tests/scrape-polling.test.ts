import test from "node:test"
import assert from "node:assert/strict"
import { reconcileActiveScrapePoll } from "../lib/scrape-polling.ts"

test("reconcileActiveScrapePoll retains active scrapes through suspicious empty polls", () => {
  const previousActive = [{ id: "scrape-1", target: "vercel/next.js" }]

  const result = reconcileActiveScrapePoll(previousActive, {
    active: [],
    completed: [],
    failed: [],
  })

  assert.deepEqual(result, {
    active: previousActive,
    didComplete: false,
    retainedPrevious: true,
  })
})

test("reconcileActiveScrapePoll clears active scrapes when completion is confirmed", () => {
  const result = reconcileActiveScrapePoll([{ id: "scrape-1", target: "vercel/next.js" }], {
    active: [],
    completed: [{ id: "scrape-1" }],
    failed: [],
  })

  assert.deepEqual(result, {
    active: [],
    didComplete: true,
    retainedPrevious: false,
  })
})

test("reconcileActiveScrapePoll clears active scrapes when failure is confirmed", () => {
  const result = reconcileActiveScrapePoll([{ id: "scrape-1", target: "vercel/next.js" }], {
    active: [],
    completed: [],
    failed: [{ id: "scrape-1" }],
  })

  assert.deepEqual(result, {
    active: [],
    didComplete: false,
    retainedPrevious: false,
  })
})

test("reconcileActiveScrapePoll accepts the latest non-empty active poll", () => {
  const nextActive = [{ id: "scrape-2", target: "solana-foundation/anchor" }]

  const result = reconcileActiveScrapePoll([{ id: "scrape-1", target: "vercel/next.js" }], {
    active: nextActive,
    completed: [],
    failed: [],
  })

  assert.deepEqual(result, {
    active: nextActive,
    didComplete: false,
    retainedPrevious: false,
  })
})
