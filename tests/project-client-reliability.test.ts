import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { resolve } from "node:path"

const source = readFileSync(
  resolve(import.meta.dirname, "../app/ecosystems/[id]/page.tsx"),
  "utf8"
)

test("Project shell and scrape mutations reject unsuccessful API responses", () => {
  assert.match(source, /if \(!ecoRes\.ok\) throw new Error/)
  assert.match(source, /if \(!scrapesRes\.ok\) throw new Error/)
  assert.match(source, /if \(!response\.ok\) throw new Error\(data\?\.error \|\| "Scrape could not be added"\)/)
  assert.match(source, /if \(!response\.ok\) throw new Error\(data\?\.error \|\| "Scrape could not be removed"\)/)
  assert.match(source, /if \(!response\.ok\) throw new Error\(data\?\.error \|\| "Project could not be deleted"\)/)
})

test("Project failure states remain visible and retryable", () => {
  assert.match(source, /Project could not load/)
  assert.match(source, /onClick=\{\(\) => void loadProjectShell\(\)\}/)
  assert.match(source, /availableScrapesError/)
  assert.match(source, /onClick=\{\(\) => void loadAvailableScrapes\(\)\}/)
  assert.match(source, /setScrapeMutationError/)
  assert.doesNotMatch(source, /console\.(?:error|warn|log|info)\s*\(/)
})
