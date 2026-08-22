import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const componentPath = new URL("../components/recent-scrapes.tsx", import.meta.url)

test("Completed Scrapes preserves its last valid list when refreshes fail", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /const \[listError, setListError\]/)
  assert.match(source, /const \[lastListLoadedAt, setLastListLoadedAt\]/)
  assert.match(source, /setListError\(null\)/)
  assert.match(source, /Completed scrapes could not refresh/)
  assert.match(source, /Showing the last update from/)
  assert.match(source, /onClick=\{fetchScrapes\}/)
  assert.doesNotMatch(source, /console\.error\("\[v0\] Failed to fetch scrapes/)
})

test("Completed Scrapes validates list and pagination contracts before mutation", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /await res\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(source, /!Array\.isArray\(data\.completed\)/)
  assert.match(source, /!Array\.isArray\(data\.failed\)/)
  assert.match(source, /typeof data\.hasMore !== "boolean"/)
  assert.match(source, /setHasMoreScrapes\(data\.hasMore\)/)
  assert.match(source, /listError \? null : <EmptyState type="repository"/)
  assert.match(source, /listError \? null : <EmptyState type="organization"/)
})
