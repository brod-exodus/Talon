import { createHash } from "node:crypto"
import { type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"
import { getRequestId } from "@/lib/request-id"
import { logWarn, sanitizeOperationalError } from "@/lib/logger"

export type AuditOutcome = "success" | "failure" | "blocked"

export type AuditEvent = {
  id: string
  action: string
  outcome: AuditOutcome
  actor: string
  ipHash: string | null
  userAgent: string | null
  metadata: Record<string, unknown>
  requestId: string | null
  createdAt: string
}

function auditSalt(): string {
  return process.env.TALON_SESSION_SECRET || process.env.TALON_ADMIN_PASSWORD || "talon"
}

export function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for")
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || "unknown"
  return request.headers.get("x-real-ip")?.trim() || "unknown"
}

export function hashAuditValue(value: string): string {
  return createHash("sha256").update(auditSalt()).update(":").update(value).digest("hex")
}

function userAgent(request: NextRequest): string | null {
  return request.headers.get("user-agent")?.slice(0, 300) || null
}

export async function recordAuditEvent({
  request,
  action,
  outcome,
  actor = "admin",
  teamId,
  metadata = {},
}: {
  request: NextRequest
  action: string
  outcome: AuditOutcome
  actor?: string
  teamId?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const requestId = getRequestId(request)
  try {
    const ip = getClientIp(request)
    const { error } = await supabaseAdmin.from("audit_events").insert({
      action,
      outcome,
      actor,
      team_id: teamId ?? null,
      ip_hash: ip === "unknown" ? null : hashAuditValue(ip),
      user_agent: userAgent(request),
      metadata,
      request_id: requestId,
    })
    if (error) throw error
  } catch (error) {
    logWarn("audit.persist_failed", {
      requestId,
      teamId: teamId ?? undefined,
      details: { action, outcome, error: sanitizeOperationalError(error) },
    })
  }
}

export async function getRecentAuditEvents(limit = 25, teamId?: string | null): Promise<AuditEvent[]> {
  let query = supabaseAdmin
    .from("audit_events")
    .select("id, action, outcome, actor, ip_hash, user_agent, metadata, request_id, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)))

  if (teamId) query = query.eq("team_id", teamId)

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((event) => ({
    id: event.id,
    action: event.action,
    outcome: event.outcome,
    actor: event.actor,
    ipHash: event.ip_hash,
    userAgent: event.user_agent,
    metadata: event.metadata ?? {},
    requestId: event.request_id ?? null,
    createdAt: event.created_at,
  }))
}
