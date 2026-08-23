import assert from "node:assert/strict"
import test from "node:test"
import { classifyScrapeFailure } from "../lib/scrape-failure-diagnostic.ts"

test("scrape failures classify GitHub conditions into operator actions", () => {
  const cases = [
    ["GitHub API error: 401 Bad credentials token=secret", "github_credentials_invalid"],
    ["GitHub API error: 404 Not Found at private/repository", "github_target_unavailable"],
    ["GitHub API error: 403 Resource not accessible by integration", "github_permission_denied"],
    ["GitHub API error: 503 Service unavailable", "github_unavailable"],
    ["GitHub request timed out after 20000ms", "github_network_error"],
  ] as const

  for (const [message, code] of cases) {
    const diagnostic = classifyScrapeFailure({ message })
    assert.equal(diagnostic.code, code)
    assert.doesNotMatch(JSON.stringify(diagnostic), /secret|private\/repository|20000/)
  }
})

test("rate-limit metadata takes precedence over an HTTP 403", () => {
  const diagnostic = classifyScrapeFailure({
    message: "GitHub API error: 403 Forbidden",
    metadata: { githubCooldownReason: "primary-rate-limit" },
  })
  assert.equal(diagnostic.code, "github_rate_limited")
  assert.match(diagnostic.guidance, /resume automatically/)
})

test("unknown internal errors fail closed with generic guidance", () => {
  const diagnostic = classifyScrapeFailure({ message: "relation secret_table does not exist" })
  assert.deepEqual(diagnostic, {
    code: "processing_error",
    summary: "Talon could not finish processing this scrape.",
    guidance: "Retry once. If it fails again, use the request ID in server logs to investigate.",
  })
})
