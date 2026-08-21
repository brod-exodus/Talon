import { beforeEach, describe, expect, test, vi } from "vitest"

const dbMocks = vi.hoisted(() => ({
  insert: vi.fn(),
  update: vi.fn(),
  activeResult: { data: null as { session_id: string } | null, error: null as Error | null },
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
        maybeSingle: async () => dbMocks.activeResult,
      }
      const updateBuilder = {
        eq(column: string, value: unknown) {
          dbMocks.filters.push([column, value])
          return updateBuilder
        },
        is: async (column: string, value: unknown) => {
          dbMocks.filters.push([column, value])
          return { error: null }
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
  revokeAllAuthSessions,
} from "@/lib/auth-sessions"

describe("revocable session registry", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("TALON_SESSION_SECRET", "test-session-secret-with-enough-length")
    vi.stubEnv("TALON_ADMIN_PASSWORD", "test-admin-password")
    dbMocks.insert.mockResolvedValue({ error: null })
    dbMocks.activeResult = { data: null, error: null }
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
})
