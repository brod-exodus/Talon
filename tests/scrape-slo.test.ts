import assert from "node:assert/strict"
import test from "node:test"
import { buildScrapeSloSnapshot, type ScrapeSloRow } from "../lib/scrape-slo.ts"

function completed(minutes: number): ScrapeSloRow {
  return {
    status: "completed",
    started_at: "2026-08-13T12:00:00.000Z",
    completed_at: new Date(Date.parse("2026-08-13T12:00:00.000Z") + minutes * 60000).toISOString(),
  }
}

test("scrape SLO snapshot calculates success rate and nearest-rank percentiles", () => {
  const snapshot = buildScrapeSloSnapshot([
    completed(1),
    completed(2),
    completed(3),
    completed(4),
    { status: "failed", started_at: "2026-08-13T12:00:00.000Z", completed_at: null },
  ])

  assert.deepEqual(snapshot, {
    sampleSize: 5,
    succeeded: 4,
    failed: 1,
    successRate: 80,
    durationSampleSize: 4,
    p50Minutes: 2,
    p95Minutes: 4,
  })
})

test("scrape SLO snapshot ignores invalid completion durations", () => {
  const snapshot = buildScrapeSloSnapshot([
    completed(1.25),
    { status: "completed", started_at: "invalid", completed_at: "2026-08-13T12:01:00.000Z" },
    { status: "completed", started_at: "2026-08-13T12:02:00.000Z", completed_at: "2026-08-13T12:01:00.000Z" },
  ])

  assert.equal(snapshot.sampleSize, 3)
  assert.equal(snapshot.successRate, 100)
  assert.equal(snapshot.durationSampleSize, 1)
  assert.equal(snapshot.p50Minutes, 1.3)
  assert.equal(snapshot.p95Minutes, 1.3)
})

test("scrape SLO snapshot represents an empty observation window explicitly", () => {
  assert.deepEqual(buildScrapeSloSnapshot([]), {
    sampleSize: 0,
    succeeded: 0,
    failed: 0,
    successRate: null,
    durationSampleSize: 0,
    p50Minutes: null,
    p95Minutes: null,
  })
})
