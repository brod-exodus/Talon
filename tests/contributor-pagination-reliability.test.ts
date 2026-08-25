import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const componentPath = new URL("../components/recent-scrapes.tsx", import.meta.url)

test("Contributor pagination validates pages before caching them", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /const data = await res\.json\(\)\.catch\(\(\) => null\)/)
  assert.match(source, /!Array\.isArray\(data\.contributors\)/)
  assert.match(source, /typeof data\.hasMore !== "boolean"/)
  assert.match(source, /getPublicApiError\(data, "Failed to load contributors"\)/)
  assert.match(source, /all\.push\(\.\.\.data\.contributors\)[\s\S]*writeContributorCache/)
  assert.doesNotMatch(source, /console\.error\("\[v0\] Failed to fetch contributors/)
  assert.doesNotMatch(source, /contactableOnly:\s*"true"/)
  assert.match(source, /const filteredByToggles = contributors/)
  assert.match(source, /View Contributors \(\{scrape\.contributorCount\}\)/)
  assert.match(source, /const contactInfoCount = scrape\.contactInfoCount/)
  assert.match(source, /disabled=\{!contributors \|\| isLoadingContributors \|\| Boolean\(contributorError\)\}/)
})

test("Contributor retry preserves partial data and resumes the failed page", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /Map<string, \{ message: string; nextPage: number \}>/)
  assert.match(source, /startPage > 1 \? \[\.\.\.\(cacheRef\.current\.get\(scrapeId\) \?\? \[\]\)\] : \[\]/)
  assert.match(source, /\{ message, nextPage: page \}/)
  assert.match(source, /fetchContributors\(scrapeId, failure\?\.nextPage \?\? 1\)/)
  assert.match(source, /contributors\.length\} contributors remain available/)
  assert.match(source, /Retry resumes from page \{contributorError\.nextPage\}/)
  assert.doesNotMatch(source, /retryContributors[\s\S]{0,250}next\.delete\(scrapeId\)/)
})
