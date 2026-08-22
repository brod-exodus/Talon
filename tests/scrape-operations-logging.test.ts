import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { resolve } from "node:path"

const operationalRoutes = [
  "app/api/rate-limit/route.ts",
  "app/api/scrape-jobs/route.ts",
  "app/api/scrape-jobs/[id]/cancel/route.ts",
  "app/api/scrape-jobs/[id]/retry/route.ts",
  "app/api/scrapes/route.ts",
  "app/api/scrapes/active/route.ts",
  "app/api/scrapes/recent/route.ts",
  "app/api/watched-repos/route.ts",
  "app/api/watched-repos/[id]/route.ts",
  "app/api/watched-repos/check/route.ts",
]

test("scrape and watched-repository operations never write raw console logs", () => {
  for (const route of operationalRoutes) {
    const source = readFileSync(resolve(import.meta.dirname, "..", route), "utf8")
    assert.doesNotMatch(source, /console\.(?:error|warn|log|info)\s*\(/, `${route} must use the sanitized logger`)
  }
})

test("unexpected operational failures use the typed safe error boundary", () => {
  for (const route of operationalRoutes.filter((route) => !route.endsWith("watched-repos/check/route.ts"))) {
    const source = readFileSync(resolve(import.meta.dirname, "..", route), "utf8")
    assert.match(source, /internalErrorResponse\(/, `${route} must return a catalogued 500 response`)
    assert.doesNotMatch(
      source,
      /NextResponse\.json\(\{\s*error:\s*error\.message/,
      `${route} must not return exception messages`
    )
  }
})
