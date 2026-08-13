import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const runner = readFileSync(resolve(import.meta.dirname, "../lib/scrape-runner.ts"), "utf8")

function organizationRunnerBody() {
  const start = runner.indexOf("async function scrapeOrganization")
  return runner.slice(start, runner.indexOf("async function scrapeRepository", start))
}

test("organization discovery fetches one repository page and persists the next cursor", () => {
  const body = organizationRunnerBody()

  assert.match(body, /getOrgReposPage\(org, pagePlan\.scannedPage\)/)
  assert.match(body, /repositoryPage: completedPage\.nextPage/)
  assert.match(body, /repositoryDiscoveryComplete: completedPage\.completesDiscovery/)
  assert.match(body, /return false/)
  assert.doesNotMatch(body, /getOrgRepos\(org\)/)
})

test("organization discovery deduplicates repositories and excludes forks and archives", () => {
  const body = organizationRunnerBody()

  assert.match(body, /Array\.from\(new Set/)
  assert.match(body, /!repo\.fork && !repo\.archived/)
})

test("in-progress jobs from the prior release keep their completed repository list", () => {
  const body = organizationRunnerBody()

  assert.match(body, /isLegacyDiscoveryComplete/)
  assert.match(body, /repositories\.length > 0/)
  assert.match(body, /initialState\.repositoryPage === undefined/)
  assert.match(body, /initialState\.repositoryDiscoveryComplete === undefined/)
})
