import {
  SCRAPE_P95_TARGET_MINUTES,
  SCRAPE_SLO_MIN_SAMPLE,
  SCRAPE_SLO_WINDOW_DAYS,
  SCRAPE_SUCCESS_TARGET_PERCENT,
  type ScrapeSloSnapshot,
} from "./scrape-slo.ts"

export type SloMonitorState = {
  state: "healthy" | "breached" | "insufficient_data"
  fingerprint: string
  sampleSize: number
  successRate: number | null
  p50Minutes: number | null
  p95Minutes: number | null
}

export type PreviousSloMonitor = {
  state?: unknown
  fingerprint?: unknown
  lastNotifiedFingerprint?: unknown
}

export function buildSloMonitorState(snapshot: ScrapeSloSnapshot): SloMonitorState {
  const reliability = snapshot.sampleSize < SCRAPE_SLO_MIN_SAMPLE
    ? "insufficient"
    : (snapshot.successRate ?? 0) >= SCRAPE_SUCCESS_TARGET_PERCENT ? "healthy" : "breached"
  const latency = snapshot.durationSampleSize < SCRAPE_SLO_MIN_SAMPLE
    ? "insufficient"
    : (snapshot.p95Minutes ?? 0) <= SCRAPE_P95_TARGET_MINUTES ? "healthy" : "breached"
  const state = reliability === "breached" || latency === "breached"
    ? "breached"
    : reliability === "insufficient" || latency === "insufficient"
      ? "insufficient_data"
      : "healthy"

  return {
    state,
    fingerprint: `reliability:${reliability};latency:${latency}`,
    sampleSize: snapshot.sampleSize,
    successRate: snapshot.successRate,
    p50Minutes: snapshot.p50Minutes,
    p95Minutes: snapshot.p95Minutes,
  }
}

export function shouldNotifySloState(
  current: SloMonitorState,
  previous?: PreviousSloMonitor | null
): boolean {
  const lastNotified = typeof previous?.lastNotifiedFingerprint === "string"
    ? previous.lastNotifiedFingerprint
    : null
  if (lastNotified === current.fingerprint) return false
  if (current.state === "breached") return true
  return current.state === "healthy" && Boolean(lastNotified?.includes(":breached"))
}

function metric(value: number | null, suffix: string): string {
  return value === null ? "not available" : `${value}${suffix}`
}

export function formatSloSlackMessage(current: SloMonitorState): string {
  const heading = current.state === "breached"
    ? "⚠️ Talon repository scrape SLO needs attention"
    : "✅ Talon repository scrape SLO recovered"
  return [
    heading,
    `${SCRAPE_SLO_WINDOW_DAYS}-day sample: ${current.sampleSize} terminal repository scrapes`,
    `Success: ${metric(current.successRate, "%")} (target ≥${SCRAPE_SUCCESS_TARGET_PERCENT}%)`,
    `Completion time: p50 ${metric(current.p50Minutes, "m")}, p95 ${metric(current.p95Minutes, "m")} (target p95 ≤${SCRAPE_P95_TARGET_MINUTES}m)`,
    "Open Talon Settings → Production Readiness for the current operational context.",
  ].join("\n")
}
