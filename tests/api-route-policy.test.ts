import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import test from "node:test"
import { execFileSync } from "node:child_process"

const repositoryRoot = resolve(import.meta.dirname, "..")

const PUBLIC_HANDLERS = new Set([
  "app/api/auth/login/route.ts#POST",
  "app/api/auth/logout/route.ts#POST",
  "app/api/auth/signup/route.ts#POST",
  "app/api/share/[token]/route.ts#GET",
])

const CRON_HANDLERS = new Set([
  "app/api/keepalive/route.ts#GET",
  "app/api/scrape-jobs/run/route.ts#POST",
  "app/api/watched-repos/check/route.ts#POST",
])

function routeFiles(): string[] {
  return execFileSync("git", ["ls-files", "app/api/**/route.ts"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean)
}

function handlersForFile(file: string): Array<{ key: string; body: string }> {
  const source = readFileSync(resolve(repositoryRoot, file), "utf8")
  const matches = [...source.matchAll(/export async function (GET|POST|PATCH|DELETE)\b/g)]
  return matches.map((match, index) => ({
    key: `${relative(repositoryRoot, resolve(repositoryRoot, file))}#${match[1]}`,
    body: source.slice(match.index, matches[index + 1]?.index ?? source.length),
  }))
}

test("every API handler has an explicit authentication policy", () => {
  const handlers = routeFiles().flatMap(handlersForFile)
  assert.ok(handlers.length >= 55, `Expected the complete API surface, found ${handlers.length} handlers`)

  for (const { key, body } of handlers) {
    if (PUBLIC_HANDLERS.has(key)) continue
    if (CRON_HANDLERS.has(key)) {
      assert.match(body, /hasCronSecret\(request\)/, `${key} must authenticate its scheduler request`)
      continue
    }
    assert.match(body, /await requirePermission\([^\n]+, "(read|write|admin)"\)/, `${key} is missing a live permission check`)
  }
})

test("the public and cron policy allowlists cannot silently drift", () => {
  const handlerKeys = new Set(routeFiles().flatMap(handlersForFile).map(({ key }) => key))

  for (const key of [...PUBLIC_HANDLERS, ...CRON_HANDLERS]) {
    assert.ok(handlerKeys.has(key), `Policy references a missing handler: ${key}`)
  }
})

test("API routes do not fall back to cookie-only requireAuth", () => {
  for (const file of routeFiles()) {
    const source = readFileSync(resolve(repositoryRoot, file), "utf8")
    assert.doesNotMatch(source, /\brequireAuth\(/, `${file} must use live requirePermission checks`)
  }
})

test("public authentication mutations enforce the same-origin boundary", () => {
  for (const key of [
    "app/api/auth/login/route.ts#POST",
    "app/api/auth/logout/route.ts#POST",
    "app/api/auth/signup/route.ts#POST",
  ]) {
    const [file] = key.split("#")
    const handler = handlersForFile(file).find((candidate) => candidate.key === key)
    assert.match(handler?.body ?? "", /requireSameOrigin\(request\)/, `${key} must reject cross-site writes`)
  }
})

test("public signup remains closed unless the server explicitly enables it", () => {
  const handler = handlersForFile("app/api/auth/signup/route.ts").find(
    (candidate) => candidate.key === "app/api/auth/signup/route.ts#POST"
  )

  assert.match(
    handler?.body ?? "",
    /if \(!isSelfServiceSignupEnabled\(\)\)/,
    "signup must fail closed before creating an auth user"
  )
})
