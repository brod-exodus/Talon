import test from "node:test"
import assert from "node:assert/strict"
import {
  createGitHubClient,
  extractContactsFromBio,
  extractSocialContacts,
  GitHubApiError,
  getGitHubRetryDecision,
  parseRateLimitResetMs,
  parseRetryAfterMs,
} from "../lib/github.ts"
import { normalizeGitHubRepositoryTarget, normalizeScrapeTarget } from "../lib/validation.ts"

test("repositoryExists returns true for an accessible repository", async () => {
  const fetchImpl = async (url: string | URL | Request) => {
    assert.equal(String(url), "https://api.github.com/repos/vercel/next.js")
    return new Response(JSON.stringify({ full_name: "vercel/next.js" }), { status: 200 })
  }
  const client = createGitHubClient("ghp_test", { fetchImpl: fetchImpl as typeof fetch })

  assert.equal(await client.repositoryExists("vercel/next.js"), true)
})

test("repositoryExists returns false for a missing repository", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ message: "Not Found" }), { status: 404, statusText: "Not Found" })
  const client = createGitHubClient("ghp_test", { fetchImpl: fetchImpl as typeof fetch })

  assert.equal(await client.repositoryExists("missing/repo"), false)
})

test("repository target normalization accepts owner repo and GitHub URL formats", () => {
  assert.equal(normalizeGitHubRepositoryTarget("firedancer-io/firedancer"), "firedancer-io/firedancer")
  assert.equal(
    normalizeGitHubRepositoryTarget("https://github.com/firedancer-io/firedancer"),
    "firedancer-io/firedancer"
  )
  assert.equal(normalizeGitHubRepositoryTarget("github.com/firedancer-io/firedancer"), "firedancer-io/firedancer")
  assert.equal(normalizeGitHubRepositoryTarget("https://github.com/firedancer-io/firedancer.git"), "firedancer-io/firedancer")
  assert.equal(normalizeScrapeTarget("repository", "https://github.com/firedancer-io/firedancer"), "firedancer-io/firedancer")
})

test("repository API calls use normalized owner and repo path", async () => {
  const urls: string[] = []
  const fetchImpl = async (url: string | URL | Request) => {
    urls.push(String(url))
    return new Response(JSON.stringify({ full_name: "firedancer-io/firedancer" }), { status: 200 })
  }
  const client = createGitHubClient("ghp_test", { fetchImpl: fetchImpl as typeof fetch })

  assert.equal(await client.repositoryExists("https://github.com/firedancer-io/firedancer"), true)
  assert.equal(await client.repositoryExists("github.com/firedancer-io/firedancer"), true)
  assert.equal(await client.repositoryExists("firedancer-io/firedancer"), true)
  assert.deepEqual(urls, [
    "https://api.github.com/repos/firedancer-io/firedancer",
    "https://api.github.com/repos/firedancer-io/firedancer",
    "https://api.github.com/repos/firedancer-io/firedancer",
  ])
})

test("GitHub API errors include the exact failing endpoint", async () => {
  const body = JSON.stringify({ message: "Not Found", status: "404" })
  const fetchImpl = async (url: string | URL | Request) => {
    assert.equal(String(url), "https://api.github.com/users/deleted-user")
    return new Response(body, { status: 404, statusText: "Not Found" })
  }
  const client = createGitHubClient("ghp_test", { fetchImpl: fetchImpl as typeof fetch, maxRetries: 0 })

  await assert.rejects(
    () => client.getUserDetails("deleted-user"),
    (error) => {
      assert.ok(error instanceof GitHubApiError)
      assert.equal(error.status, 404)
      assert.equal(error.url, "https://api.github.com/users/deleted-user")
      assert.equal(error.endpointPath, "/users/deleted-user")
      assert.equal(error.responseBody, body)
      assert.match(error.message, /GET https:\/\/api\.github\.com\/users\/deleted-user/)
      return true
    }
  )
})

test("organizationExists returns false for a missing organization", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ message: "Not Found" }), { status: 404, statusText: "Not Found" })
  const client = createGitHubClient("ghp_test", { fetchImpl: fetchImpl as typeof fetch })

  assert.equal(await client.organizationExists("missing-org"), false)
})

test("extractContactsFromBio pulls email, explicit twitter links, linkedin, and website", () => {
  const result = extractContactsFromBio(
    "Founder. Reach me at jane@example.com, https://x.com/janedoe, linkedin.com/in/jane-doe https://janedoe.dev"
  )

  assert.deepEqual(result, {
    email: "jane@example.com",
    twitter: "janedoe",
    linkedin: "https://www.linkedin.com/in/jane-doe",
    website: "https://janedoe.dev",
  })
})

test("extractContactsFromBio ignores bare GitHub bio mentions as twitter handles", () => {
  const result = extractContactsFromBio("Maintainer, OSS builder. Working on @rpcpool and contributing to @project.")

  assert.equal(result.twitter, undefined)
})

test("extractContactsFromBio extracts explicit twitter and x profile URLs", () => {
  assert.equal(extractContactsFromBio("Find me at https://x.com/someuser").twitter, "someuser")
  assert.equal(extractContactsFromBio("Find me at https://twitter.com/someuser.").twitter, "someuser")
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
