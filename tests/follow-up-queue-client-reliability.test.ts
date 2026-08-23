import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { resolve } from "node:path"

const source = readFileSync(resolve(import.meta.dirname, "../components/follow-up-queue.tsx"), "utf8")

test("Follow-Up Queue validates the complete response before replacing its snapshot", () => {
  assert.match(source, /if \(!response\.ok\) throw new Error\(data\?\.error \|\| "Follow-ups could not load"\)/)
  assert.match(source, /!Array\.isArray\(data\?\.followUps\) \|\| !data\.followUps\.every\(isFollowUpQueueItem\)/)
  assert.match(source, /tracking\.projectId === project\.id/)
  assert.match(source, /tracking\.contributorId === contributor\.id/)
})

test("Follow-Up Queue preserves stale data and never reports false success after failure", () => {
  const loader = source.slice(source.indexOf("const loadFollowUps"), source.indexOf("useEffect(() => {\n    loadFollowUps()"))
  assert.doesNotMatch(loader, /setFollowUps\(\[\]\)/)
  assert.match(source, /Showing follow-ups last updated/)
  assert.match(source, /!error && followUps\.length === 0/)
  assert.match(source, /onClick=\{loadFollowUps\}/)
  assert.doesNotMatch(source, /console\.(?:error|warn|log|info)\s*\(/)
})
