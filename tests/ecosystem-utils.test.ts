import test from "node:test"
import assert from "node:assert/strict"
import {
  aggregateEcosystemContributors,
  ecosystemCacheRowsMissingScore,
  shouldRecomputeEcosystemContributorCache,
} from "../lib/ecosystem-utils.ts"

test("aggregateEcosystemContributors merges scrape overlap and sorts by impact", () => {
  const result = aggregateEcosystemContributors(
    [
      {
        id: "c1",
        github_username: "alice",
        name: "Alice",
        avatar_url: "https://avatar/1.png",
        email: "alice@example.com",
        twitter: null,
        linkedin: null,
        website: null,
      },
      {
        id: "c2",
        github_username: "bob",
        name: null,
        avatar_url: null,
        email: null,
        twitter: "bobdev",
        linkedin: null,
        website: null,
      },
      {
        id: "c3",
        github_username: "carol",
        name: "Carol",
        avatar_url: null,
        email: null,
        twitter: null,
        linkedin: null,
        website: null,
      },
    ],
    [
      { contributor_id: "c1", scrape_id: "s1", contributions: 8 },
      { contributor_id: "c1", scrape_id: "s2", contributions: 5 },
      { contributor_id: "c2", scrape_id: "s1", contributions: 20 },
      { contributor_id: "c3", scrape_id: "s2", contributions: 50 },
    ],
    new Map([
      ["s1", "vercel/next.js"],
      ["s2", "vercel/turborepo"],
    ])
  )

  assert.equal(result.length, 2)
  assert.deepEqual(result[0], {
    id: "c1",
    username: "alice",
    name: "Alice",
    avatar: "https://avatar/1.png",
    score: null,
    scrapeCount: 2,
    scrapeTargets: ["vercel/next.js", "vercel/turborepo"],
    totalContributions: 13,
    contacts: {
      email: "alice@example.com",
      twitter: undefined,
      linkedin: undefined,
      website: undefined,
    },
  })
  assert.equal(result[1]?.username, "bob")
  assert.equal(result[1]?.scrapeCount, 1)
  assert.equal(result[1]?.totalContributions, 20)
})

test("aggregateEcosystemContributors ranks by Talon Score first, with nulls last", () => {
  const base = {
    name: null,
    avatar_url: null,
    email: "dev@example.com",
    twitter: null,
    linkedin: null,
    website: null,
  }
  const result = aggregateEcosystemContributors(
    [
      { ...base, id: "c1", github_username: "low-score", talon_score: 20 },
      { ...base, id: "c2", github_username: "high-score", talon_score: 90 },
      { ...base, id: "c3", github_username: "unscored", talon_score: null },
    ],
    [
      // low-score has more repos and contributions, but score wins.
      { contributor_id: "c1", scrape_id: "s1", contributions: 500 },
      { contributor_id: "c1", scrape_id: "s2", contributions: 500 },
      { contributor_id: "c2", scrape_id: "s1", contributions: 5 },
      { contributor_id: "c3", scrape_id: "s1", contributions: 1000 },
    ],
    new Map([
      ["s1", "vercel/next.js"],
      ["s2", "vercel/turborepo"],
    ])
  )

  assert.deepEqual(
    result.map((contributor) => contributor.username),
    ["high-score", "low-score", "unscored"]
  )
  assert.equal(result[0]?.score, 90)
  assert.equal(result[2]?.score, null)
})

test("ecosystemCacheRowsMissingScore flags pre-score cache rows only", () => {
  assert.equal(ecosystemCacheRowsMissingScore([]), false)
  assert.equal(ecosystemCacheRowsMissingScore([{ id: "c1", scrapeCount: 1 }]), true)
  assert.equal(ecosystemCacheRowsMissingScore([{ id: "c1", score: 42 }]), false)
  assert.equal(ecosystemCacheRowsMissingScore([{ id: "c1", score: null }]), false)
})

test("shouldRecomputeEcosystemContributorCache detects stale scrape membership", () => {
  assert.equal(
    shouldRecomputeEcosystemContributorCache({
      cachedScrapeIds: ["s1"],
      currentScrapeIds: ["s1", "s2"],
      cachedContributorCount: 1,
      totalScrapeContributors: 100,
      recomputedAt: "2026-05-22T12:00:00.000Z",
      latestScrapeCompletedAt: "2026-05-22T12:00:00.000Z",
      nowMs: Date.parse("2026-05-22T12:00:30.000Z"),
    }),
    true
  )
})

test("shouldRecomputeEcosystemContributorCache repairs suspicious empty caches", () => {
  assert.equal(
    shouldRecomputeEcosystemContributorCache({
      cachedScrapeIds: ["s1", "s2"],
      currentScrapeIds: ["s2", "s1"],
      cachedContributorCount: 0,
      totalScrapeContributors: 100,
      recomputedAt: "2026-05-22T12:00:00.000Z",
      latestScrapeCompletedAt: "2026-05-22T12:02:00.000Z",
      nowMs: Date.parse("2026-05-22T12:02:30.000Z"),
    }),
    true
  )
})

test("shouldRecomputeEcosystemContributorCache trusts a fresh empty cache", () => {
  assert.equal(
    shouldRecomputeEcosystemContributorCache({
      cachedScrapeIds: ["s1"],
      currentScrapeIds: ["s1"],
      cachedContributorCount: 0,
      totalScrapeContributors: 100,
      recomputedAt: "2026-05-22T12:02:00.000Z",
      latestScrapeCompletedAt: "2026-05-22T12:00:00.000Z",
      nowMs: Date.parse("2026-05-22T12:02:30.000Z"),
    }),
    false
  )
})
