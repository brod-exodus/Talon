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

test("API routes never bypass the sanitized structured logger", () => {
  const routes = routeFiles(apiRoot)
  assert.ok(routes.length > 0, "expected API routes to be discovered")

  for (const route of routes) {
    const source = readFileSync(route, "utf8")
    const name = relative(repositoryRoot, route)
    assert.doesNotMatch(
      source,
      /console\.(?:error|warn|log|info)\s*\(/,
      `${name} must use the sanitized logger`
    )
  }
})
