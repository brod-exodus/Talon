import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const panelPath = new URL("../components/health-panel.tsx", import.meta.url)

test("Production Readiness preserves its last successful snapshot on refresh failure", async () => {
  const source = await readFile(panelPath, "utf8")

  assert.match(source, /const \[loadError, setLoadError\]/)
  assert.match(source, /setLoadError\(null\)/)
  assert.match(source, /Production diagnostics could not refresh/)
  assert.match(source, /Showing the last successful check from/)
  assert.match(source, /statusBadge\(loadError \? "error"/)
  assert.doesNotMatch(source, /console\.error\("\[health\]/)
  assert.doesNotMatch(source, /catch \(error\) \{[\s\S]*setHealth\(/)
})

test("Production Readiness validates HTTP and response contracts before replacing state", async () => {
  const source = await readFile(panelPath, "utf8")

  assert.match(source, /function isHealthResponse/)
  assert.match(source, /await res\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(source, /if \(!res\.ok && !isHealthResponse\(data\)\)/)
  assert.match(source, /if \(!isHealthResponse\(data\)\)/)
  assert.match(source, /!loadError && visibleChecks\.length === 0/)
  assert.match(source, /!showHealthy && !loadError && health\?\.status === "ok"/)
})

test("Production Readiness keeps validated blocked diagnostics visible", async () => {
  const source = await readFile(panelPath, "utf8")

  assert.match(source, /if \(!res\.ok && !isHealthResponse\(data\)\)/)
  assert.match(source, /setHealth\(data\)/)
  assert.match(source, /statusBadge\(loadError \? "error" : \(health\?\.status \?\? "error"\)\)/)
})

test("Production Readiness offers contextual recovery only for failed storage cleanup", async () => {
  const source = await readFile(panelPath, "utf8")

  assert.match(source, /check\.recovery === "storage_cleanup"/)
  assert.match(source, /fetch\("\/api\/storage-cleanup\/retry", \{ method: "POST" \}\)/)
  assert.match(source, /Retry failed cleanup/)
  assert.match(source, /role="status"/)
})
