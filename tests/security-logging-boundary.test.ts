import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { resolve } from "node:path"

const securityBoundaryFiles = [
  "app/api/auth/me/route.ts",
  "app/api/auth/password/route.ts",
  "app/api/auth/signup/route.ts",
  "app/api/profile/route.ts",
  "app/api/profile/photo/route.ts",
  "app/api/slack/test/route.ts",
  "app/api/team-members/route.ts",
  "app/api/team-members/[id]/route.ts",
  "lib/login-rate-limit.ts",
  "lib/permissions.ts",
  "lib/team-context.ts",
]

test("identity and administrator boundaries never write raw console logs", () => {
  for (const file of securityBoundaryFiles) {
    const source = readFileSync(resolve(import.meta.dirname, "..", file), "utf8")
    assert.doesNotMatch(source, /console\.(?:error|warn|log)\s*\(/, `${file} must use the sanitized logger`)
  }
})

test("security fallback logs remain request-correlated", () => {
  for (const file of ["lib/login-rate-limit.ts", "lib/permissions.ts", "lib/team-context.ts"]) {
    const source = readFileSync(resolve(import.meta.dirname, "..", file), "utf8")
    assert.match(source, /log(?:Error|WarnError)\(/, `${file} must emit a structured failure event`)
    assert.match(source, /requestId/, `${file} must accept or derive request correlation`)
  }
})
