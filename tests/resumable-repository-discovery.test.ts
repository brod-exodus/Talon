import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const runner = readFileSync(resolve(import.meta.dirname, "../lib/scrape-runner.ts"), "utf8")

test("repository discovery fetches one GitHub page and persists the next cursor", () => {
  const repositoryStart = runner.indexOf("async function scrapeRepository")
  const repositoryBody = runner.slice(repositoryStart, runner.indexOf("export async function runScrapeJob", repositoryStart))

  assert.match(repositoryBody, /getRepoContributorsPage\(repo, pagePlan\.scannedPage\)/)
  assert.match(repositoryBody, /contributorPage: completedPage\.nextPage/)
  assert.match(repositoryBody, /saveScrapeCheckpoint/)
  assert.doesNotMatch(repositoryBody, /getRepoContributors\(repo\)/)
})

test("worker GitHub calls rely on durable retries instead of sleeping through the invocation budget", () => {
  assert.match(runner, /WORKER_GITHUB_REQUEST_TIMEOUT_MS = 10_000/)
  assert.match(runner, /WORKER_GITHUB_MAX_RETRIES = 0/)
  assert.match(runner, /createGitHubClient\(undefined, \{[\s\S]+requestTimeoutMs:[\s\S]+maxRetries:/)
})
