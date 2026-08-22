import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const componentPath = new URL("../components/active-scrapes.tsx", import.meta.url)

test("Active Scrapes exposes polling failures without discarding progress", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /const \[pollError, setPollError\]/)
  assert.match(source, /const \[lastUpdatedAt, setLastUpdatedAt\]/)
  assert.match(source, /setPollError\(null\)/)
  assert.match(source, /Active scrape progress could not refresh/)
  assert.match(source, /Showing progress from/)
  assert.match(source, /setRefreshKey\(\(key\) => key \+ 1\)/)
  assert.match(source, /scrapes\.length === 0 && !pollError/)
  assert.doesNotMatch(source, /console\.error\("\[v0\] Failed to fetch scrapes/)
})

test("Active Scrapes validates poll and mutation responses", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /await response\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(source, /!Array\.isArray\(data\.active\)/)
  assert.match(source, /!Array\.isArray\(data\.completed\)/)
  assert.match(source, /!Array\.isArray\(data\.failed\)/)
  assert.match(source, /data && typeof data\.error === "string"/)
  assert.match(source, /setCanceling\(\(prev\) => \{/)
  assert.match(source, /setRetrying\(\(prev\) => \{/)
})
