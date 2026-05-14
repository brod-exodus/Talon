import { type NextRequest } from "next/server"
import { getClientIp, hashAuditValue } from "@/lib/audit"
import { supabase } from "@/lib/supabase"

const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000
const LOCKOUT_MS = 15 * 60 * 1000

type RateLimitState = {
  attempts: number
  windowStartedAt: number
  lockedUntil: number | null
}

type RateLimitDecision = {
  allowed: boolean
  retryAfterSeconds?: number
}

const fallbackStore = new Map<string, RateLimitState>()

function keyForRequest(request: NextRequest): string {
  return `login:${hashAuditValue(getClientIp(request))}`
}

function retryAfterSeconds(lockedUntil: number): number {
  return Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000))
}

function fallbackDecision(key: string): RateLimitDecision {
  const state = fallbackStore.get(key)
  if (!state?.lockedUntil || state.lockedUntil <= Date.now()) return { allowed: true }
  return { allowed: false, retryAfterSeconds: retryAfterSeconds(state.lockedUntil) }
}

function fallbackFailure(key: string): void {
  const now = Date.now()
  const current = fallbackStore.get(key)
  const inWindow = current && now - current.windowStartedAt <= WINDOW_MS
  const attempts = inWindow ? current.attempts + 1 : 1
  fallbackStore.set(key, {
    attempts,
    windowStartedAt: inWindow ? current.windowStartedAt : now,
    lockedUntil: attempts >= MAX_ATTEMPTS ? now + LOCKOUT_MS : null,
  })
}

function fallbackReset(key: string): void {
  fallbackStore.delete(key)
}

export async function checkLoginRateLimit(request: NextRequest): Promise<RateLimitDecision> {
  const key = keyForRequest(request)
  try {
    const { data, error } = await supabase
      .from("auth_rate_limits")
      .select("locked_until")
      .eq("key", key)
      .maybeSingle()
    if (error) throw error

    const lockedUntil = data?.locked_until ? new Date(data.locked_until).getTime() : null
    if (lockedUntil && lockedUntil > Date.now()) {
      return { allowed: false, retryAfterSeconds: retryAfterSeconds(lockedUntil) }
    }
    return { allowed: true }
  } catch (error) {
    console.warn("[auth] Persistent login rate limit unavailable; using fallback:", error)
    return fallbackDecision(key)
  }
}

export async function recordLoginFailure(request: NextRequest): Promise<void> {
  const key = keyForRequest(request)
  const now = Date.now()

  try {
    const { data, error } = await supabase
      .from("auth_rate_limits")
      .select("attempts, window_started_at")
      .eq("key", key)
      .maybeSingle()
    if (error) throw error

    const windowStartedAt = data?.window_started_at ? new Date(data.window_started_at).getTime() : now
    const inWindow = now - windowStartedAt <= WINDOW_MS
    const attempts = inWindow ? Number(data?.attempts ?? 0) + 1 : 1
    const nextWindowStartedAt = inWindow ? new Date(windowStartedAt) : new Date(now)
    const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(now + LOCKOUT_MS).toISOString() : null

    const { error: upsertError } = await supabase.from("auth_rate_limits").upsert({
      key,
      attempts,
      window_started_at: nextWindowStartedAt.toISOString(),
      locked_until: lockedUntil,
      updated_at: new Date(now).toISOString(),
    })
    if (upsertError) throw upsertError
  } catch (error) {
    console.warn("[auth] Failed to persist login failure; using fallback:", error)
    fallbackFailure(key)
  }
}

export async function resetLoginRateLimit(request: NextRequest): Promise<void> {
  const key = keyForRequest(request)
  try {
    const { error } = await supabase.from("auth_rate_limits").delete().eq("key", key)
    if (error) throw error
  } catch (error) {
    console.warn("[auth] Failed to reset persistent login rate limit:", error)
  } finally {
    fallbackReset(key)
  }
}
