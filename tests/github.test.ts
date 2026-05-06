import test from "node:test"
import assert from "node:assert/strict"
import {
  extractContactsFromBio,
  extractSocialContacts,
  getGitHubRetryDecision,
  parseRateLimitResetMs,
  parseRetryAfterMs,
} from "../lib/github.ts"

test("extractContactsFromBio pulls email, twitter, linkedin, and website", () => {
  const result = extractContactsFromBio(
    "Founder. Reach me at jane@example.com, follow @janedoe, linkedin.com/in/jane-doe https://janedoe.dev"
  )

  assert.deepEqual(result, {
    email: "jane@example.com",
    twitter: "janedoe",
    linkedin: "https://www.linkedin.com/in/jane-doe",
    website: "https://janedoe.dev",
  })
})

test("extractContactsFromBio handles twitter handles followed by punctuation", () => {
  const result = extractContactsFromBio("Maintainer, OSS builder. Find me at @janedoe.")

  assert.equal(result.twitter, "janedoe")
})

test("extractContactsFromBio ignores social URLs when selecting website", () => {
  const result = extractContactsFromBio(
    "https://x.com/janedoe https://www.linkedin.com/in/jane-doe https://portfolio.dev"
  )

  assert.equal(result.twitter, "janedoe")
  assert.equal(result.linkedin, "https://www.linkedin.com/in/jane-doe")
  assert.equal(result.website, "https://portfolio.dev")
})

test("extractSocialContacts canonicalizes linkedin and twitter", () => {
  const result = extractSocialContacts([
    { provider: "linkedin", url: "linkedin.com/in/jane-doe" },
    { provider: "twitter", url: "https://x.com/janedoe" },
  ])

  assert.deepEqual(result, {
    twitter: "janedoe",
    linkedin: "https://www.linkedin.com/in/jane-doe",
  })
})

test("parseRetryAfterMs supports seconds and HTTP dates", () => {
  const now = Date.parse("2026-05-06T12:00:00Z")

  assert.equal(parseRetryAfterMs("3", now), 3000)
  assert.equal(parseRetryAfterMs("Wed, 06 May 2026 12:00:05 GMT", now), 5000)
  assert.equal(parseRetryAfterMs("not-a-date", now), null)
})

test("parseRateLimitResetMs reads GitHub epoch-second reset headers", () => {
  const now = Date.parse("2026-05-06T12:00:00Z")
  const resetSeconds = Math.floor((now + 15000) / 1000).toString()

  assert.equal(parseRateLimitResetMs(resetSeconds, now), 15000)
})

test("getGitHubRetryDecision prefers Retry-After for rate limits", () => {
  const headers = new Headers({
    "retry-after": "7",
    "x-ratelimit-remaining": "0",
  })

  assert.deepEqual(getGitHubRetryDecision(429, headers, "", 0), {
    retryable: true,
    delayMs: 7000,
    reason: "retry-after",
  })
})

test("getGitHubRetryDecision detects GitHub secondary rate limits", () => {
  const headers = new Headers()
  const decision = getGitHubRetryDecision(
    403,
    headers,
    "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
    1
  )

  assert.deepEqual(decision, {
    retryable: true,
    delayMs: 10000,
    reason: "secondary-rate-limit",
  })
})

test("getGitHubRetryDecision does not retry terminal client errors", () => {
  const headers = new Headers()

  assert.deepEqual(getGitHubRetryDecision(404, headers, "Not Found", 0), {
    retryable: false,
    delayMs: 0,
    reason: "terminal-http",
  })
})
