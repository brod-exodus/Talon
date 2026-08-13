export const SCRAPE_SLO_WINDOW_DAYS = 7
export const SCRAPE_SLO_MIN_SAMPLE = 5
export const SCRAPE_SUCCESS_TARGET_PERCENT = 95
export const SCRAPE_P95_TARGET_MINUTES = 3

export type ScrapeSloRow = {
  status: "completed" | "failed"
  started_at: string
  completed_at: string | null
}

export type ScrapeSloSnapshot = {
  sampleSize: number
  succeeded: number
  failed: number
  successRate: number | null
  durationSampleSize: number
  p50Minutes: number | null
  p95Minutes: number | null
}

function percentile(values: number[], percent: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.ceil((percent / 100) * sorted.length) - 1)
  return sorted[index]
}

function round(value: number, places = 1): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

export function buildScrapeSloSnapshot(rows: ScrapeSloRow[]): ScrapeSloSnapshot {
  const succeeded = rows.filter((row) => row.status === "completed").length
  const failed = rows.filter((row) => row.status === "failed").length
  const sampleSize = succeeded + failed
  const durations = rows.flatMap((row) => {
    if (row.status !== "completed" || !row.completed_at) return []
    const startedAt = Date.parse(row.started_at)
    const completedAt = Date.parse(row.completed_at)
    if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) return []
    return [(completedAt - startedAt) / 60000]
  })

  const p50 = percentile(durations, 50)
  const p95 = percentile(durations, 95)
  return {
    sampleSize,
    succeeded,
    failed,
    successRate: sampleSize > 0 ? round((succeeded / sampleSize) * 100) : null,
    durationSampleSize: durations.length,
    p50Minutes: p50 === null ? null : round(p50),
    p95Minutes: p95 === null ? null : round(p95),
  }
}
