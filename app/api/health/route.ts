import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { supabase } from "@/lib/supabase"

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
    const { error } = await supabase.from("scrapes").select("id").limit(1)
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

function overallStatus(checks: Record<string, HealthCheck>): CheckStatus {
  if (Object.values(checks).some((check) => check.status === "error")) return "error"
  if (Object.values(checks).some((check) => check.status === "warn")) return "warn"
  return "ok"
}

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  const checks: Record<string, HealthCheck> = {
    supabaseUrl: envCheck("NEXT_PUBLIC_SUPABASE_URL", { required: true }),
    supabaseAnonKey: envCheck("NEXT_PUBLIC_SUPABASE_ANON_KEY", { required: true }),
    supabaseServiceRoleKey: envCheck("SUPABASE_SERVICE_ROLE_KEY", { required: true }),
    adminPassword: envCheck("TALON_ADMIN_PASSWORD", { required: true }),
    sessionSecret: envCheck("TALON_SESSION_SECRET", { required: true, minLength: 32 }),
    cronSecret: envCheck("CRON_SECRET", { required: true, minLength: 32 }),
    slackWebhook: envCheck("SLACK_WEBHOOK_URL"),
    database: await dbCheck(),
    github: await githubCheck(),
  }

  const status = overallStatus(checks)
  return NextResponse.json({
    status,
    checkedAt: new Date().toISOString(),
    checks,
  }, { status: status === "error" ? 503 : 200 })
}
