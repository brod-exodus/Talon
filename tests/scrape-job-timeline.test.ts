import assert from "node:assert/strict"
import test from "node:test"
import { toScrapeJobTimelineEvent } from "../lib/scrape-job-timeline.ts"

test("scrape timeline exposes useful allowlisted context without operational secrets", () => {
  const event = toScrapeJobTimelineEvent({
    id: "event-1",
    team_id: "team-1",
    job_id: "job-1",
    scrape_id: "scrape-1",
    event_type: "retry_scheduled",
    message: "GitHub token ghp_secret failed for private/repo",
    metadata: {
      attempt: 2,
      maxAttempts: 3,
      retryDelayMs: 12_500,
      workerId: "worker-secret",
      githubCooldownUntil: "2030-01-01T00:00:00Z",
      target: "private/repo",
      error: "database password",
    },
    request_id: "request-secret",
    created_at: "2026-08-22T12:00:00.000Z",
  })

  assert.deepEqual(event, {
    id: "event-1",
    eventType: "retry_scheduled",
    label: "Retry scheduled",
    category: "retry",
    occurredAt: "2026-08-22T12:00:00.000Z",
    detail: "attempt 2 of 3 · retry in 13 seconds",
  })
  assert.doesNotMatch(JSON.stringify(event), /secret|private\/repo|password|worker/i)
})

test("unknown events receive a neutral label and no raw message or metadata", () => {
  const event = toScrapeJobTimelineEvent({
    id: "event-2",
    team_id: "team-1",
    job_id: "job-1",
    scrape_id: "scrape-1",
    event_type: "future_internal_event",
    message: "sensitive implementation detail",
    metadata: { arbitrary: "sensitive value" },
    request_id: null,
    created_at: "2026-08-22T12:01:00.000Z",
  })

  assert.equal(event.label, "Processing activity recorded")
  assert.equal(event.detail, null)
})
