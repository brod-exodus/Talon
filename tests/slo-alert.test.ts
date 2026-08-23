import assert from "node:assert/strict"
import test from "node:test"
import { buildSloMonitorState, formatSloSlackMessage, shouldNotifySloState } from "../lib/slo-alert.ts"
import type { ScrapeSloSnapshot } from "../lib/scrape-slo.ts"

function snapshot(overrides: Partial<ScrapeSloSnapshot> = {}): ScrapeSloSnapshot {
  return {
    sampleSize: 10,
    succeeded: 10,
    failed: 0,
    successRate: 100,
    durationSampleSize: 10,
    p50Minutes: 1.5,
    p95Minutes: 2.5,
    startSampleSize: 10,
    p50StartSeconds: 20,
    p95StartSeconds: 60,
    processingSampleSize: 10,
    p50ProcessingMinutes: 1.2,
    p95ProcessingMinutes: 2,
    p50WorkerInvocations: 1,
    p95WorkerInvocations: 2,
    ...overrides,
  }
}

test("SLO monitor distinguishes healthy, breached, and insufficient samples", () => {
  assert.equal(buildSloMonitorState(snapshot()).state, "healthy")
  assert.equal(buildSloMonitorState(snapshot({ succeeded: 8, failed: 2, successRate: 80 })).state, "breached")
  assert.equal(buildSloMonitorState(snapshot({ p95Minutes: 5 })).state, "breached")
  assert.equal(buildSloMonitorState(snapshot({ sampleSize: 2, durationSampleSize: 2 })).state, "insufficient_data")
})

test("SLO notifications are sent once per breach fingerprint and once on recovery", () => {
  const breach = buildSloMonitorState(snapshot({ p95Minutes: 5 }))
  const healthy = buildSloMonitorState(snapshot())

  assert.equal(shouldNotifySloState(breach), true)
  assert.equal(shouldNotifySloState(breach, { state: "breached", lastNotifiedFingerprint: breach.fingerprint }), false)
  assert.equal(shouldNotifySloState(healthy, { state: "breached", lastNotifiedFingerprint: breach.fingerprint }), true)
  assert.equal(shouldNotifySloState(healthy, { state: "insufficient_data", lastNotifiedFingerprint: breach.fingerprint }), true)
  assert.equal(shouldNotifySloState(healthy, { state: "breached" }), false)
  assert.equal(shouldNotifySloState(healthy, { state: "healthy", lastNotifiedFingerprint: healthy.fingerprint }), false)
})

test("SLO Slack messages contain aggregate evidence without repository or contributor data", () => {
  const message = formatSloSlackMessage(buildSloMonitorState(snapshot({ p95Minutes: 5 })))

  assert.match(message, /needs attention/)
  assert.match(message, /Success: 100%/)
  assert.match(message, /p95 5m/)
  assert.doesNotMatch(message, /github\.com|contributor|webhook/i)
})
