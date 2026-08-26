import { beforeEach, describe, expect, test, vi } from "vitest"

const dbMocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  activeResult: { data: null as { session_id: string } | null, error: null as Error | null },
  selectResult: { data: [] as Array<{ session_id: string; issued_at: string; expires_at: string }>, error: null as Error | null },
  updateResult: { data: [] as Array<{ session_id: string }> | { session_id: string } | null, error: null as Error | null },
  filters: [] as Array<[string, unknown]>,
}))

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const activeBuilder = {
        eq(column: string, value: unknown) {
          dbMocks.filters.push([column, value])
          return activeBuilder
        },
        is(column: string, value: unknown) {
          dbMocks.filters.push([column, value])
          return activeBuilder
        },
        gt(column: string, value: unknown) {
          dbMocks.filters.push([column, value])
          return activeBuilder
        },
        order() {
          return activeBuilder
        },
        limit() {
          return activeBuilder
        },
        maybeSingle: async () => dbMocks.activeResult,
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: typeof dbMocks.selectResult) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return Promise.resolve(dbMocks.selectResult).then(onfulfilled, onrejected)
        },
      }
      const updateBuilder = {
        eq(column: string, value: unknown) {
          dbMocks.filters.push([column, value])
          return updateBuilder
        },
        neq(column: string, value: unknown) {
          dbMocks.filters.push([column, value])
          return updateBuilder
        },
        is(column: string, value: unknown) {
          dbMocks.filters.push([column, value])
          return updateBuilder
        },
        gt(column: string, value: unknown) {
          dbMocks.filters.push([column, value])
          return updateBuilder
        },
        select() {
          return updateBuilder
        },
        maybeSingle: async () => dbMocks.updateResult,
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: typeof dbMocks.updateResult) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return Promise.resolve(dbMocks.updateResult).then(onfulfilled, onrejected)
        },
      }
      return {
        insert: dbMocks.insert,
        select: () => activeBuilder,
        update: (value: unknown) => {
          dbMocks.update(value)
          return updateBuilder
        },
      }
    }),
  },
}))

import { getAuthSessionFromToken } from "@/lib/auth-token"
import {
  isAuthSessionActive,
  issueSessionToken,
  listActiveAuthSessions,
  revokeAllAuthSessions,
  revokeAllAuthSessionsForIdentity,
  revokeOtherAuthSessions,
} from "@/lib/auth-sessions"

describe("revocable session registry", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("TALON_SESSION_SECRET", "test-session-secret-with-enough-length")
    vi.stubEnv("TALON_ADMIN_PASSWORD", "test-admin-password")
    dbMocks.insert.mockResolvedValue({ error: null })
    dbMocks.activeResult = { data: null, error: null }
    dbMocks.selectResult = { data: [], error: null }
    dbMocks.updateResult = { data: [], error: null }
    dbMocks.filters = []
  })

  test("registers a newly issued token without storing the token or user email", async () => {
    const token = await issueSessionToken({
      actor: "user",
      email: "recruiter@example.com",
      role: "recruiter",
      teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      teamSlug: "engineering",
    })
    const session = getAuthSessionFromToken(token)

    expect(session?.actor).toBe("user")
    expect(dbMocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      session_id: session?.sessionId,
      actor: "user",
      team_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      subject_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    const persisted = JSON.stringify(dbMocks.insert.mock.calls[0]?.[0])
    expect(persisted).not.toContain(token)
    expect(persisted).not.toContain("recruiter@example.com")
  })

  test("accepts only the matching active registry record", async () => {
    const token = await issueSessionToken()
    const session = getAuthSessionFromToken(token)
    expect(session).not.toBeNull()
    if (!session) return
    dbMocks.activeResult = { data: { session_id: session.sessionId }, error: null }

    await expect(isAuthSessionActive(session)).resolves.toBe(true)
    expect(dbMocks.filters).toContainEqual(["session_id", session.sessionId])
    expect(dbMocks.filters).toContainEqual(["revoked_at", null])
  })

  test("password rotation revokes every active session for the keyed subject", async () => {
    const token = await issueSessionToken()
    const session = getAuthSessionFromToken(token)
    expect(session).not.toBeNull()
    if (!session) return

    await revokeAllAuthSessions(session, "password_change")

    expect(dbMocks.update).toHaveBeenCalledWith(expect.objectContaining({
      revoke_reason: "password_change",
      revoked_at: expect.any(String),
    }))
    expect(dbMocks.filters).toContainEqual(["subject_hash", expect.stringMatching(/^[0-9a-f]{64}$/)])
  })

  test("recovery can revoke a user's sessions without an existing Talon session", async () => {
    await revokeAllAuthSessionsForIdentity({
      teamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      email: "Recruiter@Example.com",
    }, "password_change")

    expect(dbMocks.update).toHaveBeenCalledWith(expect.objectContaining({ revoke_reason: "password_change" }))
    expect(dbMocks.filters).toContainEqual(["subject_hash", expect.stringMatching(/^[0-9a-f]{64}$/)])
    expect(JSON.stringify(dbMocks.filters)).not.toContain("recruiter@example.com")
  })

  test("lists only unrevoked, unexpired sessions for the keyed subject", async () => {
    const token = await issueSessionToken()
    const session = getAuthSessionFromToken(token)
    expect(session).not.toBeNull()
    if (!session) return
    dbMocks.selectResult = {
      data: [{
        session_id: session.sessionId,
        issued_at: "2026-08-21T10:00:00Z",
        expires_at: "2026-08-21T22:00:00Z",
      }],
      error: null,
    }

    await expect(listActiveAuthSessions(session)).resolves.toEqual([{
      sessionId: session.sessionId,
      issuedAt: "2026-08-21T10:00:00Z",
      expiresAt: "2026-08-21T22:00:00Z",
    }])
    expect(dbMocks.filters).toContainEqual(["subject_hash", expect.stringMatching(/^[0-9a-f]{64}$/)])
    expect(dbMocks.filters).toContainEqual(["revoked_at", null])
  })

  test("bulk revocation excludes the current session", async () => {
    const token = await issueSessionToken()
    const session = getAuthSessionFromToken(token)
    expect(session).not.toBeNull()
    if (!session) return
    dbMocks.updateResult = { data: [{ session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }], error: null }

    await expect(revokeOtherAuthSessions(session)).resolves.toBe(1)
    expect(dbMocks.filters).toContainEqual(["session_id", session.sessionId])
    expect(dbMocks.update).toHaveBeenCalledWith(expect.objectContaining({ revoke_reason: "operator" }))
  })
})
