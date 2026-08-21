import { createHmac } from "node:crypto"
import test from "node:test"
import assert from "node:assert/strict"
import { createSessionToken, getAuthSessionFromToken, verifySessionToken } from "../lib/auth-token.ts"

function signPayload(payloadValue: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(payloadValue)).toString("base64url")
  const signature = createHmac("sha256", secret).update(payload).digest("base64url")
  return `${payload}.${signature}`
}

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
  assert.match(session?.sessionId ?? "", /^[0-9a-f-]{36}$/)
  assert.equal(session?.version, 2)
})

test("each login receives a unique signed session", () => {
  process.env.TALON_SESSION_SECRET = "test-session-secret-with-enough-length"

  assert.notEqual(createSessionToken(), createSessionToken())
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
  assert.equal(getAuthSessionFromToken(`${token}.ignored-segment`), null)
})

test("signed session claims fail closed instead of falling through to admin", () => {
  const secret = "test-session-secret-with-enough-length"
  process.env.TALON_SESSION_SECRET = secret
  const now = Math.floor(Date.now() / 1000)
  const envelope = {
    version: 2,
    sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    issuedAt: now,
    expiresAt: now + 3600,
  }

  assert.equal(getAuthSessionFromToken(signPayload({ ...envelope, actor: "unknown" }, secret)), null)
  assert.equal(getAuthSessionFromToken(signPayload({ ...envelope, version: 1, actor: "admin" }, secret)), null)
  assert.equal(getAuthSessionFromToken(signPayload({ ...envelope, sessionId: "not-a-uuid", actor: "admin" }, secret)), null)
  assert.equal(getAuthSessionFromToken(signPayload({
    ...envelope,
    actor: "admin",
    expiresAt: now + (13 * 60 * 60),
  }, secret)), null)
})
