import { type NextRequest, NextResponse } from "next/server"
import { getAuthSession } from "@/lib/auth"
import { isAuthOptionalForLocalDev, sessionSecret } from "@/lib/auth-token"
import { isAuthSessionActive } from "@/lib/auth-sessions"

export async function requireActiveSession(request: NextRequest): Promise<NextResponse | null> {
  if (isAuthOptionalForLocalDev()) return null

  if (!sessionSecret()) {
    return NextResponse.json(
      { error: "Server auth is not configured. Set TALON_SESSION_SECRET." },
      { status: 500 }
    )
  }

  const session = getAuthSession(request)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    if (!await isAuthSessionActive(session)) {
      return NextResponse.json({ error: "Session expired or revoked" }, { status: 401 })
    }
  } catch {
    return NextResponse.json({ error: "Session could not be verified" }, { status: 503 })
  }

  return null
}
