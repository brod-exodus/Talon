import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { resolve } from "node:path"

const source = readFileSync(resolve(import.meta.dirname, "../app/ecosystems/page.tsx"), "utf8")

test("Projects library validates every server response before changing UI state", () => {
  assert.match(source, /if \(!res\.ok\) throw new Error\(data\?\.error \|\| "Projects could not load"\)/)
  assert.match(source, /if \(!res\.ok\) throw new Error\(eco\?\.error \|\| "Project could not be created"\)/)
  assert.match(source, /if \(!response\.ok\) throw new Error\(data\?\.error \|\| "Project could not be deleted"\)/)
  assert.match(source, /if \(!eco\?\.id \|\| !eco\?\.name\) throw new Error\("Project response was incomplete"\)/)
})

test("Projects failures are visible, retryable, and distinct from an empty library", () => {
  assert.match(source, /!loading && !error && ecosystems\.length === 0/)
  assert.match(source, /onClick=\{\(\) => void load\(\)\}/)
  assert.match(source, /deletingIds\.has\(eco\.id\)/)
  assert.doesNotMatch(source, /console\.(?:error|warn|log|info)\s*\(/)
})
