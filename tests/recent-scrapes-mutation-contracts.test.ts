import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const componentPath = new URL("../components/recent-scrapes.tsx", import.meta.url)

test("Outreach state changes only after a verified server update", async () => {
  const source = await readFile(componentPath, "utf8")
  const start = source.indexOf("const updateContributorOutreach")
  const end = source.indexOf("// ── Delete", start)
  const update = source.slice(start, end)

  assert.match(update, /const data = await res\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(update, /getPublicApiError\(data, "Failed to save outreach update"\)/)
  assert.match(update, /data\.success !== true/)
  assert.match(update, /Talon could not confirm the outreach update/)
  assert.ok(update.indexOf("data.success !== true") < update.indexOf("setContributorCache"))
  assert.doesNotMatch(update, /console\.error/)
})

test("Scrape deletion requires verified success before removing local data", async () => {
  const source = await readFile(componentPath, "utf8")
  const start = source.indexOf("const deleteScrape")
  const end = source.indexOf("// ── Export", start)
  const deletion = source.slice(start, end)

  assert.match(deletion, /const data = await response\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(deletion, /getPublicApiError\(data, "Failed to delete scrape"\)/)
  assert.match(deletion, /data\.success !== true/)
  assert.match(deletion, /Talon could not confirm that the scrape was deleted/)
  assert.ok(deletion.indexOf("data.success !== true") < deletion.indexOf("setScrapes"))
  assert.doesNotMatch(deletion, /console\.error/)
})
