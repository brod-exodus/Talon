import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const componentPath = new URL("../components/recent-scrapes.tsx", import.meta.url)

test("Share history is validated and visibly retryable", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /function isShareLinkSummary/)
  assert.match(source, /const \[shareLinksError, setShareLinksError\]/)
  assert.match(source, /data\.shares\.every\(isShareLinkSummary\)/)
  assert.match(source, /Share history returned an invalid response/)
  assert.match(source, /onClick=\{\(\) => handleShare\(shareModal\.scrapeId\)\}/)
  assert.doesNotMatch(source, /console\.error\("\[share\]"/)
})

test("Share creation requires a token and valid persisted record", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /typeof data\.token !== "string"/)
  assert.match(source, /!isShareLinkSummary\(data\.share\)/)
  assert.match(source, /Talon could not confirm the new share link/)
  assert.match(source, /setShareLinks\(\(current\) => \[share, \.\.\.current\]\)/)
})

test("Share revocation verifies the matching revoked record and recovers controls", async () => {
  const source = await readFile(componentPath, "utf8")

  assert.match(source, /const \[revokingShareIds, setRevokingShareIds\]/)
  assert.match(source, /data\.share\.id !== shareId \|\| !data\.share\.revokedAt/)
  assert.match(source, /Talon could not confirm that the share link was revoked/)
  assert.match(source, /disabled=\{revokingShareIds\.has\(share\.id\)\}/)
  assert.match(source, /next\.delete\(shareId\)/)
})
