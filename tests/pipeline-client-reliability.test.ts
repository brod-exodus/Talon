import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const componentPath = new URL("../components/pipeline-workspace.tsx", import.meta.url)

test("Pipeline preserves its last validated snapshot after load failures", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /const \[loadError, setLoadError\]/)
  assert.match(source, /const \[lastLoadedAt, setLastLoadedAt\]/)
  assert.match(source, /const \[staleFilters, setStaleFilters\]/)
  assert.match(source, /lastSuccessfulViewRef/)
  assert.match(source, /const viewKey = \[projectFilter, statusFilter, dueFilter, query\]/)
  assert.match(source, /Pipeline could not refresh/)
  assert.match(source, /current filters were not applied/)
  assert.match(source, /onClick=\{\(\) => loadPipeline\(false\)\}/)
  assert.doesNotMatch(source, /setItems\(\[\]\)/)
  assert.doesNotMatch(source, /setTotalItems\(0\)/)
})

test("Pipeline validates the complete page contract before replacing state", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /function isPipelineItem/)
  assert.match(source, /data\.items\.every\(isPipelineItem\)/)
  assert.match(source, /!Array\.isArray\(data\.projects\)/)
  assert.match(source, /data\.projects\.some\(\(project: unknown\)/)
  assert.match(source, /typeof data\.total !== "number"/)
  assert.match(source, /typeof data\.hasMore !== "boolean"/)
  assert.match(source, /Pipeline returned an invalid response/)
  assert.match(source, /items\.length === 0 && !loadError/)
})

test("Pipeline mutation failures remain scoped to their action", async () => {
  const source = await readFile(componentPath, "utf8")
  const start = source.indexOf("async function updateTracking")
  const end = source.indexOf("async function markFollowedUp", start)
  const update = source.slice(start, end)

  assert.doesNotMatch(update, /setLoadError/)
  assert.match(update, /toast\(\{ title: "Could not update pipeline"/)
})
