import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const formPath = new URL("../components/scrape-form.tsx", import.meta.url)

test("Scrape submission requires the complete queue acceptance contract", async () => {
  const source = await readFile(formPath, "utf8")

  assert.match(source, /type QueuedScrapeResponse/)
  assert.match(source, /function isQueuedScrapeResponse/)
  assert.match(source, /typeof response\.scrapeId === "string"/)
  assert.match(source, /typeof response\.jobId === "string"/)
  assert.match(source, /response\.status === "queued"/)
  assert.match(source, /typeof response\.replayed === "boolean"/)
  assert.match(source, /response\.status !== 202 \|\| !isQueuedScrapeResponse\(data\)/)
})

test("Failed scrape acceptance remains retryable and does not emit raw client logs", async () => {
  const source = await readFile(formPath, "utf8")

  assert.match(source, /const data = await response\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(source, /getPublicApiError\(data, "Failed to start scrape"\)/)
  assert.match(source, /pendingRequestRef\.current = null[\s\S]*setTarget\(""\)/)
  assert.match(source, /Talon could not confirm that the scrape was queued/)
  assert.doesNotMatch(source, /console\.error\("\[v0\] Scrape error/)
})

test("Inline project creation validates response shape before selection", async () => {
  const source = await readFile(formPath, "utf8")

  assert.match(source, /getPublicApiError\(project, "Failed to create project"\)/)
  assert.match(source, /typeof project\.id !== "string"/)
  assert.match(source, /typeof project\.name !== "string"/)
})
