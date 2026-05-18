import { type NextRequest, NextResponse } from "next/server"
import { getAuthSession, requireAuth } from "@/lib/auth"
import { sessionHasPermission, type Permission } from "@/lib/permission-rules"

export { roleHasPermission, sessionHasPermission, type Permission } from "@/lib/permission-rules"

export function requirePermission(request: NextRequest, permission: Permission): NextResponse | null {
  const authError = requireAuth(request)
  if (authError) return authError

  if (!sessionHasPermission(getAuthSession(request), permission)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return null
}
