import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const componentPath = new URL("../components/recent-scrapes.tsx", import.meta.url)

test("Completed Scrapes preserves and retries Project context failures", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /const \[projectsError, setProjectsError\]/)
  assert.match(source, /const \[projectsLoading, setProjectsLoading\]/)
  assert.match(source, /fetch\("\/api\/ecosystems", \{ cache: "no-store" \}\)/)
  assert.match(source, /setProjectsError\(null\)/)
  assert.match(source, /Project filters could not refresh/)
  assert.match(source, /Showing the last successfully loaded Project options/)
  assert.match(source, /disabled=\{projectsLoading\} onClick=\{fetchProjects\}/)
  assert.doesNotMatch(source, /console\.error\("\[projects\] Failed to fetch projects/)
})

test("Completed Scrapes validates Project response shape before replacing state", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /!Array\.isArray\(data\)/)
  assert.match(source, /data\.some\(\(project\) =>/)
  assert.match(source, /typeof project\.id !== "string"/)
  assert.match(source, /typeof project\.name !== "string"/)
  assert.match(source, /setProjects\(data\.map/)
})
