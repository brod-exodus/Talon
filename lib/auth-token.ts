import { createHmac, timingSafeEqual } from "node:crypto"

export const SESSION_TTL_SECONDS = 60 * 60 * 12

export type AuthRole = "owner" | "admin" | "recruiter" | "viewer"

export type AuthSession =
  | {
      version: 1
      actor: "admin"
      expiresAt: number
    }
  | {
      version: 1
      actor: "user"
      email: string
      teamId: string
      teamSlug: string
      role: AuthRole
      expiresAt: number
    }

type SessionInput =
  | {
      actor?: "admin"
    }
  | {
      actor: "user"
      email: string
      teamId: string
      teamSlug: string
      role: AuthRole
    }

function configuredPassword(): string | undefined {
  return process.env.TALON_ADMIN_PASSWORD
}

export function sessionSecret(): string | undefined {
  return process.env.TALON_SESSION_SECRET || process.env.TALON_ADMIN_PASSWORD
}

export function isAuthOptionalForLocalDev(): boolean {
  return process.env.NODE_ENV !== "production" && !configuredPassword()
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url")
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function createSessionToken(input: SessionInput = { actor: "admin" }): string {
  const secret = sessionSecret()
  if (!secret) {
    throw new Error("TALON_SESSION_SECRET or TALON_ADMIN_PASSWORD is required")
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const payloadValue =
    input.actor === "user"
      ? {
          version: 1,
          actor: "user",
          email: input.email,
          teamId: input.teamId,
          teamSlug: input.teamSlug,
          role: input.role,
          expiresAt,
        }
      : { version: 1, actor: "admin", expiresAt }
  const payload = Buffer.from(JSON.stringify(payloadValue)).toString("base64url")
  return `${payload}.${sign(payload, secret)}`
}

function parseSessionPayload(payload: string): AuthSession | null {
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<AuthSession> & {
      expiresAt?: number
    }
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Math.floor(Date.now() / 1000)) return null

    if (parsed.actor === "user") {
      return typeof parsed.email === "string" &&
        typeof parsed.teamId === "string" &&
        typeof parsed.teamSlug === "string" &&
        (parsed.role === "owner" || parsed.role === "admin" || parsed.role === "recruiter" || parsed.role === "viewer")
        ? {
            version: 1,
            actor: "user",
            email: parsed.email,
            teamId: parsed.teamId,
            teamSlug: parsed.teamSlug,
            role: parsed.role,
            expiresAt: parsed.expiresAt,
          }
        : null
    }

    return { version: 1, actor: "admin", expiresAt: parsed.expiresAt }
  } catch {
    return null
  }
}

export function getAuthSessionFromToken(token: string | undefined): AuthSession | null {
  if (isAuthOptionalForLocalDev()) {
    return { version: 1, actor: "admin", expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }
  }
  if (!token) return null

  const secret = sessionSecret()
  if (!secret) return null

  const [payload, signature] = token.split(".")
  if (!payload || !signature) return null
  if (!safeEqual(signature, sign(payload, secret))) return null

  return parseSessionPayload(payload)
}

export function verifySessionToken(token: string | undefined): boolean {
  return getAuthSessionFromToken(token) !== null
}

export function validateAdminPassword(password: unknown): boolean {
  const expected = configuredPassword()
  return typeof password === "string" && !!expected && safeEqual(password, expected)
}
