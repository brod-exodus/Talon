import { type NextRequest, NextResponse } from "next/server"
import {
  createSessionToken,
  getAuthSessionFromToken,
  isAuthOptionalForLocalDev,
  SESSION_TTL_SECONDS,
  sessionSecret,
  validateAdminPassword,
  verifySessionToken,
  type AuthRole,
  type AuthSession,
} from "@/lib/auth-token"

const COOKIE_NAME = "talon_session"

export {
  createSessionToken,
  getAuthSessionFromToken,
  validateAdminPassword,
  verifySessionToken,
  type AuthRole,
  type AuthSession,
}

export function getAuthSession(request: NextRequest): AuthSession | null {
  if (isAuthOptionalForLocalDev()) {
    return { version: 1, actor: "admin", expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }
  }
  return getAuthSessionFromToken(request.cookies.get(COOKIE_NAME)?.value)
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

  if (!sessionSecret()) {
    return NextResponse.json(
      { error: "Server auth is not configured. Set TALON_SESSION_SECRET." },
      { status: 500 }
    )
  }

  if (!getAuthSession(request)) {
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
