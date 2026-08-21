import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import {
  parseSessionClaims,
  SESSION_TTL_SECONDS,
  SESSION_VERSION,
  type AuthRole,
  type AuthSession,
} from "./session-claims.ts"

export { SESSION_TTL_SECONDS, type AuthRole, type AuthSession } from "./session-claims.ts"

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

  const issuedAt = Math.floor(Date.now() / 1000)
  const envelope = {
    version: SESSION_VERSION,
    sessionId: randomUUID(),
    issuedAt,
    expiresAt: issuedAt + SESSION_TTL_SECONDS,
  }
  const payloadValue =
    input.actor === "user"
      ? {
          ...envelope,
          actor: "user",
          email: input.email,
          teamId: input.teamId,
          teamSlug: input.teamSlug,
          role: input.role,
        }
      : { ...envelope, actor: "admin" }
  const payload = Buffer.from(JSON.stringify(payloadValue)).toString("base64url")
  return `${payload}.${sign(payload, secret)}`
}

function parseSessionPayload(payload: string): AuthSession | null {
  try {
    return parseSessionClaims(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")))
  } catch {
    return null
  }
}

export function getAuthSessionFromToken(token: string | undefined): AuthSession | null {
  if (isAuthOptionalForLocalDev()) {
    const now = Math.floor(Date.now() / 1000)
    return {
      version: SESSION_VERSION,
      sessionId: randomUUID(),
      issuedAt: now,
      actor: "admin",
      expiresAt: now + SESSION_TTL_SECONDS,
    }
  }
  if (!token) return null

  const secret = sessionSecret()
  if (!secret) return null

  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [payload, signature] = parts
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
