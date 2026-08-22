import test from "node:test"
import assert from "node:assert/strict"
import { logError, logInfo, logWarnError, sanitizeOperationalError } from "../lib/logger.ts"

test("structured operational logs retain correlation fields and redact sensitive details", (t) => {
  let output = ""
  t.mock.method(console, "info", (value: string) => { output = value })

  logInfo("scrape.enqueue_accepted", {
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    jobId: "job-1",
    details: {
      status: "queued",
      authorization: "Bearer super-secret",
      contributorEmail: "person@example.com",
    },
  })

  const parsed = JSON.parse(output)
  assert.equal(parsed.event, "scrape.enqueue_accepted")
  assert.equal(parsed.requestId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
  assert.equal(parsed.jobId, "job-1")
  assert.equal(parsed.details.status, "queued")
  assert.equal(parsed.details.authorization, "[redacted]")
  assert.equal(parsed.details.contributorEmail, "[redacted]")
  assert.doesNotMatch(output, /super-secret|person@example\.com/)
})

test("structured error logs sanitize credentials without exposing arbitrary error objects", (t) => {
  let output = ""
  t.mock.method(console, "error", (value: string) => { output = value })

  logError(
    "scrape_worker.failed",
    new Error("GitHub token=github_pat_private failed"),
    { requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }
  )

  const parsed = JSON.parse(output)
  assert.equal(parsed.error.name, "Error")
  assert.equal(parsed.error.message, "GitHub token [redacted] failed")
  assert.doesNotMatch(output, /github_pat_private/)
  assert.deepEqual(sanitizeOperationalError({ token: "not serialized" }), {
    name: "Error",
    message: "Unknown operational error",
  })
  assert.equal(
    sanitizeOperationalError(new Error("Failed at https://api.github.com/users/private-user for person@example.com")).message,
    "Failed at [redacted-url] for [redacted-email]"
  )
})

test("structured warning logs sanitize fallback errors without losing correlation", (t) => {
  let output = ""
  t.mock.method(console, "warn", (value: string) => { output = value })

  logWarnError(
    "auth.rate_limit_check_fallback",
    new Error("password=database-secret for person@example.com"),
    { requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }
  )

  const parsed = JSON.parse(output)
  assert.equal(parsed.level, "warn")
  assert.equal(parsed.requestId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc")
  assert.equal(parsed.error.message, "password [redacted] for [redacted-email]")
  assert.doesNotMatch(output, /database-secret|person@example\.com/)
})
