import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { resolve } from "node:path"

const protectedRoutes = [
  "app/api/contributors/outreach/route.ts",
  "app/api/scrape/route.ts",
  "app/api/scrape/[id]/route.ts",
  "app/api/share/route.ts",
  "app/api/share/[token]/route.ts",
]

test("high-risk API routes use correlated internal error responses", () => {
  for (const route of protectedRoutes) {
    const source = readFileSync(resolve(import.meta.dirname, "..", route), "utf8")
    assert.match(source, /internalErrorResponse\(/, `${route} must use the safe error boundary`)
    assert.doesNotMatch(
      source,
      /\{\s*error:\s*error instanceof Error\s*\?\s*error\.message/,
      `${route} must not return exception messages`
    )
  }
})

test("the safe error boundary accepts only catalogued public messages", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../lib/api-error-response.ts"),
    "utf8"
  )
  assert.match(source, /type InternalErrorCode = keyof typeof INTERNAL_ERROR_MESSAGES/)
  assert.match(source, /\{ error: INTERNAL_ERROR_MESSAGES\[code\], requestId \}/)
  assert.match(source, /"Cache-Control": "private, no-store"/)
  assert.doesNotMatch(source, /error:\s*(?:message|unknown|Error)|stack|cause/)
})
