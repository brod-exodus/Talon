import test from "node:test"
import assert from "node:assert/strict"
import { createSessionToken, getAuthSessionFromToken, verifySessionToken } from "../lib/auth-token.ts"

test("createSessionToken stores user team context in a signed session", () => {
  process.env.TALON_ADMIN_PASSWORD = "test-admin-password"
  process.env.TALON_SESSION_SECRET = "test-session-secret-with-enough-length"

  const token = createSessionToken({
    actor: "user",
    email: "recruiter@example.com",
    role: "recruiter",
    teamId: "team-123",
    teamSlug: "default",
  })

  const session = getAuthSessionFromToken(token)

  assert.equal(verifySessionToken(token), true)
  assert.deepEqual(session && "email" in session ? {
    actor: session.actor,
    email: session.email,
    role: session.role,
    teamId: session.teamId,
    teamSlug: session.teamSlug,
  } : null, {
    actor: "user",
    email: "recruiter@example.com",
    role: "recruiter",
    teamId: "team-123",
    teamSlug: "default",
  })
})

test("getAuthSessionFromToken rejects tampered sessions", () => {
  process.env.TALON_ADMIN_PASSWORD = "test-admin-password"
  process.env.TALON_SESSION_SECRET = "test-session-secret-with-enough-length"

  const token = createSessionToken()
  const [payload, signature] = token.split(".")
  const tamperedPayload = Buffer.from(JSON.stringify({ version: 1, actor: "admin", expiresAt: 9999999999 }))
    .toString("base64url")

  assert.equal(getAuthSessionFromToken(`${tamperedPayload}.${signature}`), null)
  assert.equal(getAuthSessionFromToken(`${payload}.not-the-signature`), null)
})
