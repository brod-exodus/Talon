import { type NextRequest, NextResponse } from "next/server"
import { getAuthSession } from "@/lib/auth"
import { roleHasPermission, type Permission } from "@/lib/permission-rules"
import { getCurrentRequestMembership } from "@/lib/request-membership"
import { requireSameOrigin } from "@/lib/request-origin"
import { requireActiveSession } from "@/lib/session-authorization"

export { roleHasPermission, sessionHasPermission, type Permission } from "@/lib/permission-rules"

export async function requirePermission(
  request: NextRequest,
  permission: Permission
): Promise<NextResponse | null> {
  const authError = await requireActiveSession(request)
  if (authError) return authError

  const originError = requireSameOrigin(request)
  if (originError) return originError

  const session = getAuthSession(request)
  if (session?.actor === "admin") return null
  if (session?.actor !== "user") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const membership = await getCurrentRequestMembership(request)
    if (!membership || !roleHasPermission(membership.role, permission)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }
    return null
  } catch (error) {
    console.error("[permissions] Failed to verify current team membership", {
      message: error instanceof Error ? error.message : "Unknown authorization error",
    })
    return NextResponse.json({ error: "Authorization could not be verified" }, { status: 503 })
  }
}
