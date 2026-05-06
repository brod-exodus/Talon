import { createHmac, timingSafeEqual } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"

const COOKIE_NAME = "talon_session"
const SESSION_TTL_SECONDS = 60 * 60 * 12

function configuredPassword(): string | undefined {
  return process.env.TALON_ADMIN_PASSWORD
}

function sessionSecret(): string | undefined {
  return process.env.TALON_SESSION_SECRET || process.env.TALON_ADMIN_PASSWORD
}

function isAuthOptionalForLocalDev(): boolean {
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

export function createSessionToken(): string {
  const secret = sessionSecret()
  if (!secret) {
    throw new Error("TALON_SESSION_SECRET or TALON_ADMIN_PASSWORD is required")
  }

  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  const payload = Buffer.from(JSON.stringify({ expiresAt })).toString("base64url")
  return `${payload}.${sign(payload, secret)}`
}

export function verifySessionToken(token: string | undefined): boolean {
  if (isAuthOptionalForLocalDev()) return true
  if (!token) return false

  const secret = sessionSecret()
  if (!secret) return false

  const [payload, signature] = token.split(".")
  if (!payload || !signature) return false
  if (!safeEqual(signature, sign(payload, secret))) return false

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { expiresAt?: number }
    return typeof parsed.expiresAt === "number" && parsed.expiresAt > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

export function validateAdminPassword(password: unknown): boolean {
  const expected = configuredPassword()
  return typeof password === "string" && !!expected && safeEqual(password, expected)
}

export function setAuthCookie(response: NextResponse, token: string): void {
  response.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  })
}

export function clearAuthCookie(response: NextResponse): void {
  response.cookies.set({
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
}

export function requireAuth(request: NextRequest): NextResponse | null {
  if (isAuthOptionalForLocalDev()) return null

  if (!configuredPassword() || !sessionSecret()) {
    return NextResponse.json(
      { error: "Server auth is not configured. Set TALON_ADMIN_PASSWORD and TALON_SESSION_SECRET." },
      { status: 500 }
    )
  }

  if (!verifySessionToken(request.cookies.get(COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  return null
}

export function hasCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const auth = request.headers.get("authorization")
  return auth === `Bearer ${secret}`
}

