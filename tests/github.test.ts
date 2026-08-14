import test from "node:test"
import assert from "node:assert/strict"
import {
  createGitHubClient,
  extractContactsFromBio,
  extractSocialContacts,
  GitHubApiError,
  getGitHubCooldownReason,
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

test("repository contributor pages expose a resumable cursor without fetching ahead", async () => {
  const urls: string[] = []
  const contributors = Array.from({ length: 100 }, (_, index) => ({
    id: index,
    login: `user-${index}`,
    avatar_url: "",
    html_url: "",
    contributions: index + 1,
  }))
  const fetchImpl = async (url: string | URL | Request) => {
    urls.push(String(url))
    return new Response(JSON.stringify(contributors), {
      status: 200,
      headers: {
        Link: '<https://api.github.com/repositories/1/contributors?per_page=100&page=3>; rel="next"',
      },
    })
  }
  const client = createGitHubClient("ghp_test", { fetchImpl: fetchImpl as typeof fetch })

  const result = await client.getRepoContributorsPage("vercel/next.js", 2)

  assert.equal(result.page, 2)
  assert.equal(result.contributors.length, 100)
  assert.equal(result.hasNext, true)
  assert.deepEqual(urls, ["https://api.github.com/repos/vercel/next.js/contributors?per_page=100&page=2"])
})

test("repository contributor pages stop when GitHub omits a next-page link", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify([{ id: 1, login: "octocat", avatar_url: "", html_url: "", contributions: 1 }]))
  const client = createGitHubClient("ghp_test", { fetchImpl: fetchImpl as typeof fetch })

  const result = await client.getRepoContributorsPage("octocat/Hello-World", 0)

  assert.equal(result.page, 1)
  assert.equal(result.hasNext, false)
  assert.equal(result.contributors[0]?.login, "octocat")
})

test("the full contributor helper remains compatible by following page results", async () => {
  const urls: string[] = []
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: index,
    login: `user-${index}`,
    avatar_url: "",
    html_url: "",
    contributions: index + 1,
  }))
  const fetchImpl = async (url: string | URL | Request) => {
    urls.push(String(url))
    const page = new URL(String(url)).searchParams.get("page")
    if (page === "1") {
      return new Response(JSON.stringify(firstPage), {
        headers: { Link: '<https://api.github.com/repositories/1/contributors?per_page=100&page=2>; rel="next"' },
      })
    }
    return new Response(
      JSON.stringify([{ id: 101, login: "last-user", avatar_url: "", html_url: "", contributions: 1 }])
    )
  }
  const client = createGitHubClient("ghp_test", { fetchImpl: fetchImpl as typeof fetch })

  const contributors = await client.getRepoContributors("vercel/next.js")

  assert.equal(contributors.length, 101)
  assert.equal(urls.length, 2)
  assert.match(urls[1] ?? "", /page=2$/)
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

test("organization repository pages expose a resumable cursor without fetching ahead", async () => {
  const urls: string[] = []
  const repositories = Array.from({ length: 100 }, (_, index) => ({
    full_name: `example/repo-${index}`,
    fork: index === 0,
    archived: index === 1,
  }))
  const fetchImpl = async (url: string | URL | Request) => {
    urls.push(String(url))
    return new Response(JSON.stringify(repositories), {
      headers: {
        Link: '<https://api.github.com/organizations/1/repos?per_page=100&page=4>; rel="next"',
      },
    })
  }
  const client = createGitHubClient("ghp_test", { fetchImpl: fetchImpl as typeof fetch })

  const result = await client.getOrgReposPage("example", 3)

  assert.equal(result.page, 3)
  assert.equal(result.repositories.length, 100)
  assert.equal(result.repositories[0]?.fork, true)
  assert.equal(result.repositories[1]?.archived, true)
  assert.equal(result.hasNext, true)
  assert.deepEqual(urls, [
    "https://api.github.com/orgs/example/repos?per_page=100&sort=full_name&direction=asc&page=3",
  ])
})

test("the full organization repository helper remains compatible across pages", async () => {
  const urls: string[] = []
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    full_name: `example/repo-${index}`,
    fork: false,
    archived: false,
  }))
  const fetchImpl = async (url: string | URL | Request) => {
    urls.push(String(url))
    const page = new URL(String(url)).searchParams.get("page")
    if (page === "1") {
      return new Response(JSON.stringify(firstPage), {
        headers: { Link: '<https://api.github.com/organizations/1/repos?per_page=100&page=2>; rel="next"' },
      })
    }
    return new Response(JSON.stringify([{ full_name: "example/final", fork: false, archived: false }]))
  }
  const client = createGitHubClient("ghp_test", { fetchImpl: fetchImpl as typeof fetch })

  const repositories = await client.getOrgRepos("example")

  assert.equal(repositories.length, 101)
  assert.equal(urls.length, 2)
  assert.match(urls[1] ?? "", /page=2$/)
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

test("only GitHub wait responses activate the shared cooldown", () => {
  assert.equal(getGitHubCooldownReason(new GitHubApiError("limited", {
    retryAfterMs: 60_000,
    retryReason: "primary-rate-limit",
  })), "primary-rate-limit")
  assert.equal(getGitHubCooldownReason(new GitHubApiError("unavailable", {
    retryAfterMs: 60_000,
    retryReason: "transient-http",
  })), null)
  assert.equal(getGitHubCooldownReason(new GitHubApiError("terminal", {
    retryReason: "terminal-http",
  })), null)
})
