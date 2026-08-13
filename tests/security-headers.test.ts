import assert from "node:assert/strict"
import test from "node:test"
import nextConfig from "../next.config.mjs"

test("every route receives Talon's browser security headers", async () => {
  const rules = await nextConfig.headers?.()
  const globalRule = rules?.find((rule) => rule.source === "/:path*")
  assert.ok(globalRule, "Expected a global security-header rule")

  const headers = new Map(globalRule.headers.map(({ key, value }) => [key, value]))
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff")
  assert.equal(headers.get("X-Frame-Options"), "DENY")
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin")
  assert.equal(headers.get("Cross-Origin-Opener-Policy"), "same-origin")
  assert.equal(headers.get("Permissions-Policy"), "camera=(), microphone=(), geolocation=()")

  const csp = headers.get("Content-Security-Policy") ?? ""
  assert.match(csp, /default-src 'self'/)
  assert.match(csp, /object-src 'none'/)
  assert.match(csp, /base-uri 'self'/)
  assert.match(csp, /form-action 'self'/)
  assert.match(csp, /frame-ancestors 'none'/)
  assert.doesNotMatch(csp, /default-src \*/)
})
