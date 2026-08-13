import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  buildSloMonitorState,
  formatSloSlackMessage,
  shouldNotifySloState,
  type PreviousSloMonitor,
  type SloMonitorState,
} from "@/lib/slo-alert"
import { buildScrapeSloSnapshot, SCRAPE_SLO_WINDOW_DAYS, type ScrapeSloRow } from "@/lib/scrape-slo"
import { normalizeSlackWebhookUrl } from "@/lib/validation"

export const dynamic = "force-dynamic"

function hasCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  return request.headers.get("authorization") === `Bearer ${secret}`
}

function createKeepaliveClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

type SloNotificationStatus =
  | "sent"
  | "unchanged"
  | "not_configured"
  | "invalid_configuration"
  | "history_unavailable"
  | "failed"

type SloMonitorDetails = SloMonitorState & {
  lastNotifiedFingerprint: string | null
  notification: SloNotificationStatus
}

function readPreviousMonitor(details: unknown): PreviousSloMonitor | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null
  const monitor = (details as { sloMonitor?: unknown }).sloMonitor
  return monitor && typeof monitor === "object" && !Array.isArray(monitor)
    ? monitor as PreviousSloMonitor
    : null
}

async function sendSloNotification(webhookUrl: string, monitor: SloMonitorState): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: formatSloSlackMessage(monitor) }),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Slack returned HTTP ${response.status}`)
}

export async function GET(request: NextRequest) {
  if (!hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const supabase = createKeepaliveClient()
    const { error } = await supabase.from("team_memberships").select("id").limit(1)

    if (error) {
      console.error("[keepalive] Supabase query failed:", error)
      return NextResponse.json({ error: "Supabase keepalive query failed" }, { status: 500 })
    }

    const { data: retention, error: retentionError } = await supabase.rpc("cleanup_talon_retention")
    if (retentionError) {
      console.error("[keepalive] Retention cleanup failed:", retentionError)
      return NextResponse.json({ error: "Supabase retention cleanup failed" }, { status: 500 })
    }

    const since = new Date(Date.now() - SCRAPE_SLO_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data: sloRows, error: sloError } = await supabase
      .from("scrapes")
      .select("status, started_at, completed_at")
      .eq("type", "repository")
      .in("status", ["completed", "failed"])
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(1000)

    let sloMonitor: SloMonitorDetails | { state: "unavailable"; notification: "not_evaluated" }
    if (sloError) {
      console.error("[keepalive] SLO calculation failed:", sloError)
      sloMonitor = { state: "unavailable", notification: "not_evaluated" }
    } else {
      const current = buildSloMonitorState(buildScrapeSloSnapshot((sloRows ?? []) as ScrapeSloRow[]))
      const { data: previousRun, error: previousRunError } = await supabase
        .from("system_runs")
        .select("details")
        .eq("kind", "keepalive")
        .eq("status", "success")
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      const previous = readPreviousMonitor(previousRun?.details)
      const previousNotification = typeof previous?.lastNotifiedFingerprint === "string"
        ? previous.lastNotifiedFingerprint
        : null
      let lastNotifiedFingerprint = previousNotification
      let notification: SloNotificationStatus = "unchanged"

      if (previousRunError) {
        console.error("[keepalive] Could not read prior SLO state:", previousRunError)
        notification = "history_unavailable"
      } else if (shouldNotifySloState(current, previous)) {
        const configuredWebhook = process.env.SLACK_WEBHOOK_URL
        const webhookUrl = normalizeSlackWebhookUrl(configuredWebhook)
        if (!configuredWebhook) {
          notification = "not_configured"
        } else if (!webhookUrl) {
          notification = "invalid_configuration"
        } else {
          try {
            await sendSloNotification(webhookUrl, current)
            lastNotifiedFingerprint = current.fingerprint
            notification = "sent"
          } catch (error) {
            console.error("[keepalive] SLO Slack notification failed:", error)
            notification = "failed"
          }
        }
      }

      sloMonitor = { ...current, lastNotifiedFingerprint, notification }
    }

    const timestamp = new Date().toISOString()
    const { error: runError } = await supabase.from("system_runs").insert({
      kind: "keepalive",
      status: "success",
      started_at: timestamp,
      completed_at: timestamp,
      details: { source: "vercel_cron", retention, sloMonitor },
    })
    if (runError) {
      console.error("[keepalive] Failed to record operational status:", runError)
      return NextResponse.json({ error: "Supabase keepalive status recording failed" }, { status: 500 })
    }

    return NextResponse.json({ success: true, timestamp, retention, sloMonitor })
  } catch (error) {
    console.error("[keepalive] request failed:", error)
    return NextResponse.json({ error: "Supabase keepalive failed" }, { status: 500 })
  }
}
