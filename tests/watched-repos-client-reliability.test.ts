import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { resolve } from "node:path"

const source = readFileSync(resolve(import.meta.dirname, "../components/watched-repos.tsx"), "utf8")

test("Watched Repository refreshes preserve stale data and expose retryable failures", () => {
  assert.match(source, /setLoadError\(err instanceof Error \? err\.message/)
  assert.match(source, /setRepos\(data\)\s*\n\s*setLoadError\(null\)/)
  assert.match(source, /!loadError && repos\.length === 0/)
  assert.match(source, /onClick=\{\(\) => void fetchRepos\(\)\}/)
  assert.doesNotMatch(source, /catch[\s\S]{0,160}setRepos\(\[\]\)/)
})

test("Watched Repository mutations validate responses and recover busy controls", () => {
  assert.match(source, /if \(!res\.ok\) throw new Error\(added\?\.error \|\| "Failed to add repository"\)/)
  assert.match(source, /if \(!res\.ok\) throw new Error\(data\?\.error \|\| "Failed to remove repository"\)/)
  assert.match(source, /deletingIds\.has\(r\.id\)/)
  assert.doesNotMatch(source, /console\.(?:error|warn|log|info)\s*\(/)
})
