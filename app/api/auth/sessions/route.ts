import { type NextRequest, NextResponse } from "next/server"
import { getAuthSession } from "@/lib/auth"
import {
  listActiveAuthSessions,
  revokeAuthSessionById,
  revokeOtherAuthSessions,
} from "@/lib/auth-sessions"
import { recordAuditEvent } from "@/lib/audit"
import { requirePermission } from "@/lib/permissions"
import { readJsonObject } from "@/lib/validation"

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest) {
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  const session = getAuthSession(request)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const sessions = await listActiveAuthSessions(session)
    if (!sessions.some((item) => item.sessionId === session.sessionId)) {
      sessions.unshift({
        sessionId: session.sessionId,
        issuedAt: new Date(session.issuedAt * 1000).toISOString(),
        expiresAt: new Date(session.expiresAt * 1000).toISOString(),
      })
    }
    return NextResponse.json({
      sessions: sessions.map((item) => ({
        ...item,
        current: item.sessionId === session.sessionId,
      })),
    })
  } catch {
    return NextResponse.json({ error: "Could not load active sessions." }, { status: 503 })
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  const session = getAuthSession(request)
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await readJsonObject(request)
  try {
    if (body?.scope === "others") {
      const revokedCount = await revokeOtherAuthSessions(session)
      await recordAuditEvent({
        request,
        action: "auth.session_revoke",
        outcome: "success",
        teamId: session.actor === "user" ? session.teamId : null,
        metadata: { scope: "others", revokedCount },
      })
      return NextResponse.json({ success: true, revokedCount })
    }

    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : ""
    if (!SESSION_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: "A valid session ID is required." }, { status: 400 })
    }
    if (sessionId === session.sessionId) {
      return NextResponse.json({ error: "Use Sign Out to end the current session." }, { status: 400 })
    }

    const revoked = await revokeAuthSessionById(session, sessionId)
    await recordAuditEvent({
      request,
      action: "auth.session_revoke",
      outcome: revoked ? "success" : "blocked",
      teamId: session.actor === "user" ? session.teamId : null,
      metadata: { scope: "selected", revoked },
    })
    return NextResponse.json({ success: true, revoked })
  } catch {
    await recordAuditEvent({
      request,
      action: "auth.session_revoke",
      outcome: "failure",
      teamId: session.actor === "user" ? session.teamId : null,
      metadata: { reason: "session_revocation_failed" },
    })
    return NextResponse.json({ error: "Could not revoke active sessions." }, { status: 503 })
  }
}
