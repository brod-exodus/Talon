import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"

const migration = readFileSync(
  resolve(import.meta.dirname, "../db/migrations/041_contactable_contributor_locations.sql"),
  "utf8"
)

test("lightweight contactable contributor rows include location", () => {
  assert.match(migration, /RETURNS TABLE[\s\S]*?location TEXT/i)
  assert.match(migration, /c\.location/i)
  assert.doesNotMatch(migration, /c\.bio|c\.company/i)
})

test("contactable contributor function remains service-role only and records schema v41", () => {
  const signature = "get_contactable_scrape_contributors_page\\(TEXT, INTEGER, INTEGER\\)"
  assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature} FROM PUBLIC`, "i"))
  assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role`, "i"))
  assert.match(migration, /\(41,\s*'contactable_contributor_locations'\)/i)
})
