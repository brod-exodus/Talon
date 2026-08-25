import assert from "node:assert/strict"
import test from "node:test"
import { buildMergedPullRequestsUrl } from "../lib/github-merged-pr-search.ts"

function parsedQuery(url: string | null): { q: string | null; type: string | null } {
  assert.ok(url)
  const parsed = new URL(url)
  assert.equal(parsed.origin, "https://github.com")
  assert.equal(parsed.pathname, "/search")
  return { q: parsed.searchParams.get("q"), type: parsed.searchParams.get("type") }
}

test("builds a merged pull-request search scoped to a repository", () => {
  const url = buildMergedPullRequestsUrl({
    target: "bitcoin/bitcoin",
    type: "repository",
    username: "johndoe",
  })
  assert.deepEqual(parsedQuery(url), {
    q: "repo:bitcoin/bitcoin is:pr is:merged author:johndoe",
    type: "pullrequests",
  })
})

test("builds a merged pull-request search scoped to an organization", () => {
  const url = buildMergedPullRequestsUrl({ target: "bitcoin", type: "organization", username: "johndoe" })
  assert.deepEqual(parsedQuery(url), {
    q: "org:bitcoin is:pr is:merged author:johndoe",
    type: "pullrequests",
  })
})

test("normalizes supported GitHub repository and organization URLs", () => {
  assert.equal(
    parsedQuery(buildMergedPullRequestsUrl({
      target: "https://github.com/bitcoin/bitcoin.git/",
      type: "repository",
      username: "valid-user",
    })).q,
    "repo:bitcoin/bitcoin is:pr is:merged author:valid-user"
  )
  assert.equal(
    parsedQuery(buildMergedPullRequestsUrl({
      target: "https://github.com/bitcoin/",
      type: "organization",
      username: "valid-user",
    })).q,
    "org:bitcoin is:pr is:merged author:valid-user"
  )
})

test("rejects missing, malformed, or ambiguous inputs", () => {
  const invalidCases = [
    { target: "", type: "repository", username: "johndoe" },
    { target: "bitcoin/bitcoin", type: "repository", username: "" },
    { target: "bitcoin/bitcoin", type: "unknown", username: "johndoe" },
    { target: "https://example.com/bitcoin/bitcoin", type: "repository", username: "johndoe" },
    { target: "bitcoin/bitcoin/extra", type: "repository", username: "johndoe" },
    { target: "bitcoin", type: "organization", username: "-invalid" },
  ]
  for (const input of invalidCases) assert.equal(buildMergedPullRequestsUrl(input), null)
})
