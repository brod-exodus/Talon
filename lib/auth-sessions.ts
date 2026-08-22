import { createHmac } from "node:crypto"
import {
  createSessionToken,
  getAuthSessionFromToken,
  isAuthOptionalForLocalDev,
  sessionSecret,
  type AuthSession,
  type SessionInput,
} from "@/lib/auth-token"
import { supabaseAdmin } from "@/lib/supabase"
import { MAX_ACTIVE_AUTH_SESSIONS } from "@/lib/session-limits"

export type SessionRevokeReason = "logout" | "password_change" | "operator"

export type ActiveAuthSession = {
  sessionId: string
  issuedAt: string
  expiresAt: string
}

function subjectValue(session: AuthSession): string {
  return session.actor === "admin"
    ? "admin"
    : `user:${session.teamId}:${session.email.trim().toLowerCase()}`
}

export function sessionSubjectHash(session: AuthSession): string {
  const secret = sessionSecret()
  if (!secret) throw new Error("TALON_SESSION_SECRET or TALON_ADMIN_PASSWORD is required")
  return createHmac("sha256", secret).update(subjectValue(session)).digest("hex")
}

export async function registerAuthSession(session: AuthSession): Promise<void> {
  if (isAuthOptionalForLocalDev()) return

  const { error } = await supabaseAdmin.from("auth_sessions").insert({
    session_id: session.sessionId,
    actor: session.actor,
    subject_hash: sessionSubjectHash(session),
    team_id: session.actor === "user" ? session.teamId : null,
    issued_at: new Date(session.issuedAt * 1000).toISOString(),
    expires_at: new Date(session.expiresAt * 1000).toISOString(),
  })
  if (error) throw new Error("Could not register the authenticated session.")
}

export async function issueSessionToken(input: SessionInput = { actor: "admin" }): Promise<string> {
  const token = createSessionToken(input)
  const session = getAuthSessionFromToken(token)
  if (!session) throw new Error("Could not validate the newly issued session.")
  await registerAuthSession(session)
  return token
}

export async function isAuthSessionActive(session: AuthSession): Promise<boolean> {
  if (isAuthOptionalForLocalDev()) return true

  const { data, error } = await supabaseAdmin
    .from("auth_sessions")
    .select("session_id")
    .eq("session_id", session.sessionId)
    .eq("subject_hash", sessionSubjectHash(session))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  if (error) throw new Error("Could not verify the authenticated session.")
  return data?.session_id === session.sessionId
}

export async function revokeAuthSession(
  session: AuthSession,
  reason: SessionRevokeReason
): Promise<void> {
  if (isAuthOptionalForLocalDev()) return

  const { error } = await supabaseAdmin
    .from("auth_sessions")
    .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
    .eq("session_id", session.sessionId)
    .eq("subject_hash", sessionSubjectHash(session))
    .is("revoked_at", null)
  if (error) throw new Error("Could not revoke the authenticated session.")
}

export async function revokeAllAuthSessions(
  session: AuthSession,
  reason: SessionRevokeReason
): Promise<void> {
  if (isAuthOptionalForLocalDev()) return

  const { error } = await supabaseAdmin
    .from("auth_sessions")
    .update({ revoked_at: new Date().toISOString(), revoke_reason: reason })
    .eq("subject_hash", sessionSubjectHash(session))
    .is("revoked_at", null)
  if (error) throw new Error("Could not revoke the authenticated sessions.")
}

export async function listActiveAuthSessions(session: AuthSession): Promise<ActiveAuthSession[]> {
  if (isAuthOptionalForLocalDev()) return []

  const { data, error } = await supabaseAdmin
    .from("auth_sessions")
    .select("session_id, issued_at, expires_at")
    .eq("subject_hash", sessionSubjectHash(session))
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("issued_at", { ascending: false })
    .limit(MAX_ACTIVE_AUTH_SESSIONS)
  if (error) throw new Error("Could not list active sessions.")

  return (data ?? []).map((row) => ({
    sessionId: row.session_id,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
  }))
}

export async function revokeAuthSessionById(
  session: AuthSession,
  sessionId: string
): Promise<boolean> {
  if (isAuthOptionalForLocalDev()) return false

  const { data, error } = await supabaseAdmin
    .from("auth_sessions")
    .update({ revoked_at: new Date().toISOString(), revoke_reason: "operator" })
    .eq("session_id", sessionId)
    .eq("subject_hash", sessionSubjectHash(session))
    .is("revoked_at", null)
    .select("session_id")
    .maybeSingle()
  if (error) throw new Error("Could not revoke the selected session.")
  return data?.session_id === sessionId
}

export async function revokeOtherAuthSessions(session: AuthSession): Promise<number> {
  if (isAuthOptionalForLocalDev()) return 0

  const { data, error } = await supabaseAdmin
    .from("auth_sessions")
    .update({ revoked_at: new Date().toISOString(), revoke_reason: "operator" })
    .eq("subject_hash", sessionSubjectHash(session))
    .neq("session_id", session.sessionId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("session_id")
  if (error) throw new Error("Could not revoke other active sessions.")
  return data?.length ?? 0
}
