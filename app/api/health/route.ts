import { type NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/permissions"
import { supabaseAdmin } from "@/lib/supabase"

type CheckStatus = "ok" | "warn" | "error"

type HealthCheck = {
  status: CheckStatus
  message: string
  detail?: string
}

function envCheck(name: string, options: { required?: boolean; minLength?: number } = {}): HealthCheck {
  const value = process.env[name]
  if (!value) {
    return options.required
      ? { status: "error", message: `${name} is missing` }
      : { status: "warn", message: `${name} is not configured` }
  }
  if (options.minLength && value.length < options.minLength) {
    return { status: "warn", message: `${name} is configured but shorter than recommended` }
  }
  return { status: "ok", message: `${name} is configured` }
}

async function dbCheck(): Promise<HealthCheck> {
  try {
    const { error } = await supabaseAdmin.from("scrapes").select("id").limit(1)
    if (error) {
      return { status: "error", message: "Database query failed", detail: error.message }
    }
    return { status: "ok", message: "Database is reachable" }
  } catch (error) {
    return {
      status: "error",
      message: "Database check threw an error",
      detail: error instanceof Error ? error.message : "Unknown database error",
    }
  }
}

async function githubCheck(): Promise<HealthCheck> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return { status: "error", message: "GITHUB_TOKEN is missing" }
  }

  try {
    const response = await fetch("https://api.github.com/rate_limit", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
      cache: "no-store",
    })
    if (!response.ok) {
      return { status: "error", message: "GitHub token check failed", detail: `HTTP ${response.status}` }
    }
    const data = await response.json()
    const remaining = Number(data?.resources?.core?.remaining ?? data?.rate?.remaining)
    const limit = Number(data?.resources?.core?.limit ?? data?.rate?.limit)
    if (Number.isFinite(remaining) && remaining < 100) {
      return { status: "warn", message: "GitHub core rate limit is low", detail: `${remaining}/${limit} remaining` }
    }
    return {
      status: "ok",
      message: "GitHub token is valid",
      detail: Number.isFinite(remaining) ? `${remaining}/${limit} remaining` : undefined,
    }
  } catch (error) {
    return {
      status: "error",
      message: "GitHub check threw an error",
      detail: error instanceof Error ? error.message : "Unknown GitHub error",
    }
  }
}

function ageDetail(timestamp: string): string {
  const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 60000))
  return `${new Date(timestamp).toISOString()} (${ageMinutes} minute${ageMinutes === 1 ? "" : "s"} ago)`
}

async function lastSystemRunCheck(
  kind: "keepalive" | "scrape_worker",
  staleAfterMinutes: number
): Promise<HealthCheck> {
  const { data, error } = await supabaseAdmin
    .from("system_runs")
    .select("completed_at")
    .eq("kind", kind)
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    return { status: "error", message: `Could not read ${kind} run history`, detail: error.message }
  }
  if (!data?.completed_at) {
    return { status: "warn", message: `No successful ${kind} invocation has been recorded` }
  }

  const ageMinutes = (Date.now() - new Date(data.completed_at).getTime()) / 60000
  return {
    status: ageMinutes > staleAfterMinutes ? "warn" : "ok",
    message: ageMinutes > staleAfterMinutes ? `Last ${kind} invocation is stale` : `Last ${kind} invocation succeeded`,
    detail: ageDetail(data.completed_at),
  }
}

async function queueCheck(): Promise<HealthCheck> {
  const { data, error } = await supabaseAdmin
    .from("scrape_jobs")
    .select("status, created_at, run_after, locked_at")
    .in("status", ["queued", "running", "failed"])
    .order("created_at", { ascending: true })
    .limit(1000)
  if (error) return { status: "error", message: "Could not inspect scrape queue", detail: error.message }

  const rows = data ?? []
  const queued = rows.filter((row) => row.status === "queued")
  const dueQueued = queued.filter((row) => new Date(row.run_after).getTime() <= Date.now())
  const running = rows.filter((row) => row.status === "running")
  const failed = rows.filter((row) => row.status === "failed")
  const staleRunning = running.filter(
    (row) => row.locked_at && Date.now() - new Date(row.locked_at).getTime() > 10 * 60 * 1000
  )
  const oldestQueuedMinutes = dueQueued[0]
    ? Math.max(0, Math.round((Date.now() - new Date(dueQueued[0].created_at).getTime()) / 60000))
    : 0
  const status: CheckStatus = staleRunning.length || oldestQueuedMinutes > 10 ? "error" : failed.length ? "warn" : "ok"

  return {
    status,
    message: `${queued.length} queued (${dueQueued.length} due), ${running.length} running, ${failed.length} failed`,
    detail: `${staleRunning.length} stale running; oldest queued ${oldestQueuedMinutes} minute${oldestQueuedMinutes === 1 ? "" : "s"}`,
  }
}

function overallStatus(checks: Record<string, HealthCheck>): CheckStatus {
  if (Object.values(checks).some((check) => check.status === "error")) return "error"
  if (Object.values(checks).some((check) => check.status === "warn")) return "warn"
  return "ok"
}

export async function GET(request: NextRequest) {
  const authError = await requirePermission(request, "admin")
  if (authError) return authError

  const [database, github, keepalive, scrapeWorker, scrapeQueue] = await Promise.all([
    dbCheck(),
    githubCheck(),
    lastSystemRunCheck("keepalive", 36 * 60),
    lastSystemRunCheck("scrape_worker", 10),
    queueCheck(),
  ])
  const checks: Record<string, HealthCheck> = {
    supabaseUrl: envCheck("NEXT_PUBLIC_SUPABASE_URL", { required: true }),
    supabaseAnonKey: envCheck("NEXT_PUBLIC_SUPABASE_ANON_KEY", { required: true }),
    supabaseServiceRoleKey: envCheck("SUPABASE_SERVICE_ROLE_KEY", { required: true }),
    adminPassword: envCheck("TALON_ADMIN_PASSWORD", { required: true }),
    sessionSecret: envCheck("TALON_SESSION_SECRET", { required: true, minLength: 32 }),
    cronSecret: envCheck("CRON_SECRET", { required: true, minLength: 32 }),
    slackWebhook: envCheck("SLACK_WEBHOOK_URL"),
    database,
    github,
    keepalive,
    scrapeWorker,
    scrapeQueue,
  }

  const status = overallStatus(checks)
  return NextResponse.json({
    status,
    checkedAt: new Date().toISOString(),
    checks,
  }, { status: status === "error" ? 503 : 200 })
}
