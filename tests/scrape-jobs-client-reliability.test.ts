import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const panelPath = new URL("../components/scrape-jobs-panel.tsx", import.meta.url)

test("Scrape Operations preserves stale queue data and exposes polling failures", async () => {
  const source = await readFile(panelPath, "utf8")

  assert.match(source, /const \[loadError, setLoadError\]/)
  assert.match(source, /const \[lastLoadedAt, setLastLoadedAt\]/)
  assert.match(source, /setLoadError\(null\)/)
  assert.match(source, /Scrape operations could not refresh/)
  assert.match(source, /Showing the last update from/)
  assert.match(source, /onClick=\{loadJobs\}/)
  assert.doesNotMatch(source, /catch \(error\) \{\s*console\.error\("\[scrape-jobs\]/)
})

test("Scrape Operations validates reads and preserves public mutation errors", async () => {
  const source = await readFile(panelPath, "utf8")

  assert.match(source, /fetch\("\/api\/scrape-jobs", \{ cache: "no-store" \}\)/)
  assert.match(source, /Array\.isArray\(data\.jobs\)/)
  assert.match(source, /data && typeof data\.error === "string"/)
  assert.match(source, /setRetrying\(\(prev\) => \{/)
  assert.match(source, /setCanceling\(\(prev\) => \{/)
})
