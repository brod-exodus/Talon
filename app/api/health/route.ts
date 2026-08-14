import { type NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/permissions"
import { getActiveGitHubCooldown, type ServiceCooldown } from "@/lib/db"
import { EXPECTED_SCHEMA_VERSION } from "@/lib/schema-version"
import {
  buildScrapeSloSnapshot,
  SCRAPE_P95_TARGET_MINUTES,
  SCRAPE_SLO_MIN_SAMPLE,
  SCRAPE_SLO_WINDOW_DAYS,
  SCRAPE_SUCCESS_TARGET_PERCENT,
  type ScrapeSloRow,
} from "@/lib/scrape-slo"
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

async function schemaVersionCheck(): Promise<HealthCheck> {
  try {
    const { data, error } = await supabaseAdmin.rpc("get_talon_schema_version")
    if (error) {
      return {
        status: "error",
        message: "Database schema version is unavailable",
        detail: `Expected v${EXPECTED_SCHEMA_VERSION}. Apply pending migrations in numeric order.`,
      }
    }

    const currentVersion = Number(data)
    if (!Number.isInteger(currentVersion) || currentVersion < 1) {
      return {
        status: "error",
        message: "Database returned an invalid schema version",
        detail: `Expected v${EXPECTED_SCHEMA_VERSION}; received ${String(data)}`,
      }
    }
    if (currentVersion < EXPECTED_SCHEMA_VERSION) {
      return {
        status: "error",
        message: "Database migrations are behind this application",
        detail: `Current v${currentVersion}; expected v${EXPECTED_SCHEMA_VERSION}`,
      }
    }
    if (currentVersion > EXPECTED_SCHEMA_VERSION) {
      return {
        status: "warn",
        message: "Database schema is ahead of this application",
        detail: `Current v${currentVersion}; application expects v${EXPECTED_SCHEMA_VERSION}`,
      }
    }
    return {
      status: "ok",
      message: "Database schema matches this application",
      detail: `Current v${currentVersion}; expected v${EXPECTED_SCHEMA_VERSION}`,
    }
  } catch {
    return {
      status: "error",
      message: "Database schema version check failed",
      detail: `Expected v${EXPECTED_SCHEMA_VERSION}. Apply pending migrations in numeric order.`,
    }
  }
}

async function githubCooldownCheck(): Promise<{
  cooldown: ServiceCooldown | null
  check: HealthCheck
}> {
  try {
    const cooldown = await getActiveGitHubCooldown()
    if (!cooldown) {
      return {
        cooldown: null,
        check: { status: "ok", message: "No active GitHub API cooldown" },
      }
    }
    return {
      cooldown,
      check: {
        status: "warn",
        message: "GitHub API requests are temporarily paused",
        detail: `Automatic resume ${new Date(cooldown.blockedUntil).toISOString()} · ${cooldown.reason.replaceAll("-", " ")}`,
      },
    }
  } catch {
    return {
      cooldown: null,
      check: { status: "warn", message: "Could not inspect the GitHub API cooldown" },
    }
  }
}

async function githubCheck(cooldown: ServiceCooldown | null): Promise<HealthCheck> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    return { status: "error", message: "GITHUB_TOKEN is missing" }
  }

  if (cooldown) {
    return {
      status: "warn",
      message: "GitHub credential check deferred during API cooldown",
      detail: `Requests resume automatically at ${new Date(cooldown.blockedUntil).toISOString()}`,
    }
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

async function sloAlertingCheck(): Promise<HealthCheck> {
  const { data, error } = await supabaseAdmin
    .from("system_runs")
    .select("completed_at, details")
    .eq("kind", "keepalive")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { status: "warn", message: "Could not read SLO alert history" }

  const details = data?.details && typeof data.details === "object" && !Array.isArray(data.details)
    ? data.details as Record<string, unknown>
    : null
  const monitor = details?.sloMonitor && typeof details.sloMonitor === "object" && !Array.isArray(details.sloMonitor)
    ? details.sloMonitor as Record<string, unknown>
    : null
  if (!monitor) {
    return {
      status: "warn",
      message: "No SLO alert evaluation has been recorded",
      detail: "Run the authenticated keepalive after deploying this release.",
    }
  }

  const state = typeof monitor.state === "string" ? monitor.state : "unavailable"
  const notification = typeof monitor.notification === "string" ? monitor.notification : "unknown"
  if (["failed", "invalid_configuration", "history_unavailable", "not_evaluated"].includes(notification)) {
    return {
      status: "warn",
      message: "SLO alert monitoring needs attention",
      detail: `Last evaluation: ${state}; notification: ${notification.replaceAll("_", " ")}`,
    }
  }
  if (notification === "not_configured") {
    return {
      status: "warn",
      message: "SLO breach detected without Slack alerting",
      detail: "Configure SLACK_WEBHOOK_URL to receive state-change notifications.",
    }
  }

  return {
    status: "ok",
    message: "SLO alert monitor evaluated successfully",
    detail: `Last evaluation: ${state}; notification: ${notification.replaceAll("_", " ")}`,
  }
}

async function queueCheck(githubCooldown: ServiceCooldown | null): Promise<HealthCheck> {
  const { data, error } = await supabaseAdmin
    .from("scrape_jobs")
    .select("status, created_at, run_after, locked_at")
    .in("status", ["queued", "running", "failed"])
    .order("created_at", { ascending: true })
    .limit(1000)
  if (error) return { status: "error", message: "Could not inspect scrape queue", detail: error.message }

  const rows = data ?? []
  const queued = rows.filter((row) => row.status === "queued")
  const timeDueQueued = queued.filter((row) => new Date(row.run_after).getTime() <= Date.now())
  const pausedQueued = githubCooldown ? timeDueQueued : []
  const dueQueued = githubCooldown ? [] : timeDueQueued
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
    detail: `${staleRunning.length} stale running; ${pausedQueued.length} waiting on GitHub; oldest queued ${oldestQueuedMinutes} minute${oldestQueuedMinutes === 1 ? "" : "s"}`,
  }
}

function scrapeReliabilityCheck(snapshot: ReturnType<typeof buildScrapeSloSnapshot>): HealthCheck {
  const target = `Target ≥${SCRAPE_SUCCESS_TARGET_PERCENT}% over ${SCRAPE_SLO_WINDOW_DAYS} days`
  if (snapshot.sampleSize < SCRAPE_SLO_MIN_SAMPLE) {
    return {
      status: "ok",
      message: "Limited repository scrape sample",
      detail: `${snapshot.sampleSize} terminal scrape${snapshot.sampleSize === 1 ? "" : "s"}; ${target}`,
    }
  }

  const successRate = snapshot.successRate ?? 0
  return {
    status: successRate >= SCRAPE_SUCCESS_TARGET_PERCENT ? "ok" : "warn",
    message: successRate >= SCRAPE_SUCCESS_TARGET_PERCENT
      ? "Repository scrape reliability meets target"
      : "Repository scrape reliability is below target",
    detail: `${successRate}% success (${snapshot.succeeded} succeeded, ${snapshot.failed} failed); ${target}`,
  }
}

function scrapeLatencyCheck(snapshot: ReturnType<typeof buildScrapeSloSnapshot>): HealthCheck {
  const target = `Target p95 ≤${SCRAPE_P95_TARGET_MINUTES} minutes over ${SCRAPE_SLO_WINDOW_DAYS} days`
  if (snapshot.durationSampleSize < SCRAPE_SLO_MIN_SAMPLE) {
    return {
      status: "ok",
      message: "Limited repository latency sample",
      detail: `${snapshot.durationSampleSize} completed scrape${snapshot.durationSampleSize === 1 ? "" : "s"}; ${target}`,
    }
  }

  const p95 = snapshot.p95Minutes ?? 0
  return {
    status: p95 <= SCRAPE_P95_TARGET_MINUTES ? "ok" : "warn",
    message: p95 <= SCRAPE_P95_TARGET_MINUTES
      ? "Repository scrape latency meets target"
      : "Repository scrape latency is above target",
    detail: `p50 ${snapshot.p50Minutes} minutes; p95 ${p95} minutes; ${target}`,
  }
}

async function scrapeSloChecks(): Promise<{
  scrapeReliability: HealthCheck
  scrapeLatency: HealthCheck
}> {
  const since = new Date(Date.now() - SCRAPE_SLO_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabaseAdmin
    .from("scrapes")
    .select("status, started_at, completed_at")
    .eq("type", "repository")
    .in("status", ["completed", "failed"])
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(1000)

  if (error) {
    const check = { status: "warn" as const, message: "Could not calculate repository scrape SLOs" }
    return { scrapeReliability: check, scrapeLatency: check }
  }

  const snapshot = buildScrapeSloSnapshot((data ?? []) as ScrapeSloRow[])
  return {
    scrapeReliability: scrapeReliabilityCheck(snapshot),
    scrapeLatency: scrapeLatencyCheck(snapshot),
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

  const githubCooldown = await githubCooldownCheck()
  const [database, databaseSchema, github, keepalive, scrapeWorker, scrapeQueue, scrapeSlos, sloAlerting] = await Promise.all([
    dbCheck(),
    schemaVersionCheck(),
    githubCheck(githubCooldown.cooldown),
    lastSystemRunCheck("keepalive", 36 * 60),
    lastSystemRunCheck("scrape_worker", 10),
    queueCheck(githubCooldown.cooldown),
    scrapeSloChecks(),
    sloAlertingCheck(),
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
    databaseSchema,
    github,
    githubCooldown: githubCooldown.check,
    keepalive,
    scrapeWorker,
    scrapeQueue,
    sloAlerting,
    ...scrapeSlos,
  }

  const status = overallStatus(checks)
  return NextResponse.json({
    status,
    checkedAt: new Date().toISOString(),
    checks,
  }, { status: status === "error" ? 503 : 200 })
}
