import { createHash } from "node:crypto"
import { type NextRequest } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export type AuditOutcome = "success" | "failure" | "blocked"

export type AuditEvent = {
  id: string
  action: string
  outcome: AuditOutcome
  actor: string
  ipHash: string | null
  userAgent: string | null
  metadata: Record<string, unknown>
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
  metadata = {},
}: {
  request: NextRequest
  action: string
  outcome: AuditOutcome
  actor?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const ip = getClientIp(request)
    const { error } = await supabaseAdmin.from("audit_events").insert({
      action,
      outcome,
      actor,
      ip_hash: ip === "unknown" ? null : hashAuditValue(ip),
      user_agent: userAgent(request),
      metadata,
    })
    if (error) throw error
  } catch (error) {
    console.warn("[audit] Failed to record audit event:", error)
  }
}

export async function getRecentAuditEvents(limit = 25): Promise<AuditEvent[]> {
  const { data, error } = await supabaseAdmin
    .from("audit_events")
    .select("id, action, outcome, actor, ip_hash, user_agent, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 100)))
  if (error) throw error

  return (data ?? []).map((event) => ({
    id: event.id,
    action: event.action,
    outcome: event.outcome,
    actor: event.actor,
    ipHash: event.ip_hash,
    userAgent: event.user_agent,
    metadata: event.metadata ?? {},
    createdAt: event.created_at,
  }))
}
