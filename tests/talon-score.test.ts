import test from "node:test"
import assert from "node:assert/strict"
import {
  BREADTH_MAX_POINTS,
  CONTACTABILITY_MAX_POINTS,
  DEPTH_MAX_POINTS,
  INFLUENCE_MAX_POINTS,
  RECENCY_MAX_POINTS,
  computeTalonScore,
  shouldRecomputeTalonScore,
  type TalonScoreInputs,
} from "../lib/talon-score.ts"

const NOW_MS = Date.parse("2026-06-11T00:00:00Z")

function daysAgo(days: number): string {
  return new Date(NOW_MS - days * 24 * 60 * 60 * 1000).toISOString()
}

function makeInputs(overrides: Partial<TalonScoreInputs> = {}): TalonScoreInputs {
  return {
    totalContributions: 0,
    completedScrapeCount: 0,
    bestShare: 0,
    bestSharePool: 0,
    latestScrapeCompletedAt: null,
    contacts: {},
    nowMs: NOW_MS,
    ...overrides,
  }
}

test("depth saturates at heavy contribution volume", () => {
  const heavy = computeTalonScore(makeInputs({ totalContributions: 5000, completedScrapeCount: 1, latestScrapeCompletedAt: daysAgo(400) }))
  assert.equal(heavy.breakdown.depth, DEPTH_MAX_POINTS)

  const light = computeTalonScore(makeInputs({ totalContributions: 10, completedScrapeCount: 1, latestScrapeCompletedAt: daysAgo(400) }))
  assert.ok(light.breakdown.depth > 0)
  assert.ok(light.breakdown.depth < DEPTH_MAX_POINTS)

  const none = computeTalonScore(makeInputs())
  assert.equal(none.breakdown.depth, 0)
})

test("breadth saturates at five completed scrapes", () => {
  const wide = computeTalonScore(makeInputs({ completedScrapeCount: 8 }))
  assert.equal(wide.breakdown.breadth, BREADTH_MAX_POINTS)

  const narrow = computeTalonScore(makeInputs({ completedScrapeCount: 1 }))
  assert.equal(narrow.breakdown.breadth, Math.round(BREADTH_MAX_POINTS / 5))
})

test("influence requires both share and a real contributor pool", () => {
  const maintainer = computeTalonScore(makeInputs({ bestShare: 1, bestSharePool: 10 }))
  assert.equal(maintainer.breakdown.influence, INFLUENCE_MAX_POINTS)

  const soloRepo = computeTalonScore(makeInputs({ bestShare: 1, bestSharePool: 1 }))
  assert.equal(soloRepo.breakdown.influence, 0)

  const smallPool = computeTalonScore(makeInputs({ bestShare: 1, bestSharePool: 3 }))
  assert.ok(smallPool.breakdown.influence > 0)
  assert.ok(smallPool.breakdown.influence < INFLUENCE_MAX_POINTS)
})

test("recency decays from full at 30 days to zero at 365 days", () => {
  const fresh = computeTalonScore(makeInputs({ completedScrapeCount: 1, latestScrapeCompletedAt: daysAgo(5) }))
  assert.equal(fresh.breakdown.recency, RECENCY_MAX_POINTS)

  const boundary = computeTalonScore(makeInputs({ completedScrapeCount: 1, latestScrapeCompletedAt: daysAgo(30) }))
  assert.equal(boundary.breakdown.recency, RECENCY_MAX_POINTS)

  const halfway = computeTalonScore(makeInputs({ completedScrapeCount: 1, latestScrapeCompletedAt: daysAgo(197.5) }))
  assert.ok(Math.abs(halfway.breakdown.recency - RECENCY_MAX_POINTS / 2) <= 1)

  const stale = computeTalonScore(makeInputs({ completedScrapeCount: 1, latestScrapeCompletedAt: daysAgo(400) }))
  assert.equal(stale.breakdown.recency, 0)

  const unknown = computeTalonScore(makeInputs({ completedScrapeCount: 1, latestScrapeCompletedAt: null }))
  assert.equal(unknown.breakdown.recency, 0)
})

test("contactability weights email highest and caps at the max", () => {
  const emailOnly = computeTalonScore(makeInputs({ contacts: { email: "dev@example.com" } }))
  assert.equal(emailOnly.breakdown.contactability, 9)

  const everything = computeTalonScore(
    makeInputs({
      contacts: { email: "dev@example.com", linkedin: "https://linkedin.com/in/dev", twitter: "dev", website: "https://dev.io" },
    })
  )
  assert.equal(everything.breakdown.contactability, CONTACTABILITY_MAX_POINTS)

  const blank = computeTalonScore(makeInputs({ contacts: { email: "  " } }))
  assert.equal(blank.breakdown.contactability, 0)
})

test("zero-data contributor scores contactability only with an honest explanation", () => {
  const result = computeTalonScore(makeInputs({ contacts: { email: "dev@example.com" } }))
  assert.equal(result.score, 9)
  assert.match(result.breakdown.explanation, /no completed scrape data yet/)
  assert.match(result.breakdown.explanation, /reachable by email/)

  const nothing = computeTalonScore(makeInputs())
  assert.equal(nothing.score, 0)
  assert.match(nothing.breakdown.explanation, /no contact info on file/)
})

test("score is always an integer within 0-100", () => {
  const maxed = computeTalonScore(
    makeInputs({
      totalContributions: 100_000,
      completedScrapeCount: 50,
      bestShare: 1,
      bestSharePool: 100,
      latestScrapeCompletedAt: daysAgo(1),
      contacts: { email: "dev@example.com", linkedin: "in", twitter: "t", website: "w" },
    })
  )
  assert.equal(maxed.score, 100)
  assert.ok(Number.isInteger(maxed.score))

  const empty = computeTalonScore(makeInputs())
  assert.equal(empty.score, 0)
})

test("explanation summarizes the strongest signals", () => {
  const result = computeTalonScore(
    makeInputs({
      totalContributions: 3400,
      completedScrapeCount: 4,
      bestShare: 1,
      bestSharePool: 40,
      latestScrapeCompletedAt: daysAgo(12),
      contacts: { email: "dev@example.com" },
    })
  )
  assert.match(result.breakdown.explanation, /^\d+\/100 — /)
  assert.match(result.breakdown.explanation, /heavy contributor \(3\.4k contributions\)/)
  assert.match(result.breakdown.explanation, /across 4 scrapes/)
  assert.match(result.breakdown.explanation, /top contributor in one repo/)
  assert.match(result.breakdown.explanation, /seen in a scrape 12d ago/)
  assert.match(result.breakdown.explanation, /reachable by email/)
})

test("shouldRecomputeTalonScore flags missing or stale scores", () => {
  assert.equal(shouldRecomputeTalonScore({ score: null, computedAt: null, latestCompletedSourceAt: null }), true)
  assert.equal(shouldRecomputeTalonScore({ score: 50, computedAt: null, latestCompletedSourceAt: null }), true)
  assert.equal(shouldRecomputeTalonScore({ score: 50, computedAt: "not-a-date", latestCompletedSourceAt: null }), true)
  assert.equal(
    shouldRecomputeTalonScore({ score: 50, computedAt: daysAgo(10), latestCompletedSourceAt: daysAgo(2) }),
    true
  )
  assert.equal(
    shouldRecomputeTalonScore({ score: 50, computedAt: daysAgo(2), latestCompletedSourceAt: daysAgo(10) }),
    false
  )
  assert.equal(shouldRecomputeTalonScore({ score: 50, computedAt: daysAgo(2), latestCompletedSourceAt: null }), false)
})
