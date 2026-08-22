import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const formPath = new URL("../components/scrape-form.tsx", import.meta.url)

test("Scrape form duplicate detection is explicit, validated, and retryable", async () => {
  const source = await readFile(formPath, "utf8")

  assert.match(source, /const \[existingTargetsError, setExistingTargetsError\]/)
  assert.match(source, /fetch\("\/api\/scrapes\/recent\?limit=50", \{ cache: "no-store" \}\)/)
  assert.match(source, /!Array\.isArray\(data\.completed\)/)
  assert.match(source, /setExistingTargetsError\(null\)/)
  assert.match(source, /Duplicate detection is unavailable/)
  assert.match(source, /setExistingTargetsRefreshKey\(\(key\) => key \+ 1\)/)
})

test("Scrape form Project context is explicit, validated, and retryable", async () => {
  const source = await readFile(formPath, "utf8")

  assert.match(source, /const \[projectsError, setProjectsError\]/)
  assert.match(source, /fetch\("\/api\/ecosystems", \{ cache: "no-store" \}\)/)
  assert.match(source, /data\.some\(\(project\) =>/)
  assert.match(source, /setProjectsError\(null\)/)
  assert.match(source, /Existing Projects are unavailable/)
  assert.match(source, /setProjectsRefreshKey\(\(key\) => key \+ 1\)/)
  assert.doesNotMatch(source, /\.catch\(\(\) => \{\}\)/)
})
