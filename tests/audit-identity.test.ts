import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { resolveAuditActor } from "../lib/audit-identity.ts"

test("audit actors are inferred from the authenticated request", () => {
  assert.equal(resolveAuditActor({ actor: "user", email: "person@example.com" }, false), "user")
  assert.equal(resolveAuditActor({ actor: "admin" }, false), "admin")
  assert.equal(resolveAuditActor(null, true), "cron")
  assert.equal(resolveAuditActor(null, false), "anonymous")
})

test("an explicit actor handles authentication events without an existing session", () => {
  assert.equal(resolveAuditActor(null, false, "user"), "user")
  assert.equal(resolveAuditActor(null, false, "admin"), "admin")
})

test("manual operations cannot be hard-coded as break-glass admin actions", () => {
  const root = resolve(import.meta.dirname, "..")
  for (const file of [
    "app/api/scrape-jobs/run/route.ts",
    "app/api/watched-repos/check/route.ts",
  ]) {
    const source = readFileSync(resolve(root, file), "utf8")
    assert.doesNotMatch(source, /actor:\s*isCronRequest\s*\?\s*["']cron["']\s*:\s*["']admin["']/)
  }
})
