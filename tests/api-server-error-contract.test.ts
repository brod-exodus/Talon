import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import { join, relative, resolve } from "node:path"

const repositoryRoot = resolve(import.meta.dirname, "..")
const apiRoot = join(repositoryRoot, "app/api")

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return routeFiles(path)
    return entry.name === "route.ts" ? [path] : []
  })
}

test("API routes cannot construct ad hoc 5xx responses", () => {
  for (const route of routeFiles(apiRoot)) {
    const source = readFileSync(route, "utf8")
    const name = relative(repositoryRoot, route)
    assert.doesNotMatch(
      source,
      /status\s*:\s*5\d\d/,
      `${name} must use the catalogued server-error contract`
    )
  }
})

test("catalogued service failures are correlated and non-cacheable", () => {
  const source = readFileSync(join(repositoryRoot, "lib/api-error-response.ts"), "utf8")
  assert.match(source, /const SERVICE_ERROR_MESSAGES = \{/)
  assert.match(source, /type ServiceErrorCode = keyof typeof SERVICE_ERROR_MESSAGES/)
  assert.match(source, /\{ error: error\.message, code, requestId \}/)
  assert.match(source, /status: error\.status/)
  assert.match(source, /"Cache-Control": "private, no-store"/)
})
