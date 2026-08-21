export const SESSION_VERSION = 3
export const SESSION_TTL_SECONDS = 60 * 60 * 12
const MAX_CLOCK_SKEW_SECONDS = 60
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AuthRole = "owner" | "admin" | "recruiter" | "viewer"

type SessionEnvelope = {
  version: typeof SESSION_VERSION
  sessionId: string
  issuedAt: number
  expiresAt: number
}

export type AuthSession =
  | SessionEnvelope & { actor: "admin" }
  | SessionEnvelope & {
      actor: "user"
      email: string
      teamId: string
      teamSlug: string
      role: AuthRole
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isRole(value: unknown): value is AuthRole {
  return value === "owner" || value === "admin" || value === "recruiter" || value === "viewer"
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

export function parseSessionClaims(
  value: unknown,
  nowSeconds = Math.floor(Date.now() / 1000)
): AuthSession | null {
  if (!isRecord(value) || value.version !== SESSION_VERSION) return null
  if (!isNonEmptyString(value.sessionId) || !SESSION_ID_RE.test(value.sessionId)) return null
  if (!Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt)) return null

  const issuedAt = value.issuedAt as number
  const expiresAt = value.expiresAt as number
  if (issuedAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS) return null
  if (expiresAt <= nowSeconds || expiresAt <= issuedAt) return null
  if (expiresAt - issuedAt > SESSION_TTL_SECONDS) return null

  const envelope: SessionEnvelope = {
    version: SESSION_VERSION,
    sessionId: value.sessionId,
    issuedAt,
    expiresAt,
  }

  if (value.actor === "admin") return { ...envelope, actor: "admin" }
  if (
    value.actor !== "user" ||
    !isNonEmptyString(value.email) ||
    !isNonEmptyString(value.teamId) ||
    !isNonEmptyString(value.teamSlug) ||
    !isRole(value.role)
  ) return null

  return {
    ...envelope,
    actor: "user",
    email: value.email,
    teamId: value.teamId,
    teamSlug: value.teamSlug,
    role: value.role,
  }
}
