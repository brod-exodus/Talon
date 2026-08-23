export const SCRAPE_SLO_WINDOW_DAYS = 7
export const SCRAPE_SLO_MIN_SAMPLE = 5
export const SCRAPE_SUCCESS_TARGET_PERCENT = 95
export const SCRAPE_P95_TARGET_MINUTES = 3
export const SCRAPE_START_P95_TARGET_SECONDS = 90

export type ScrapeSloRow = {
  id?: string
  status: "completed" | "failed"
  started_at: string
  completed_at: string | null
}

export type ScrapeClaimRow = {
  scrape_id: string | null
  created_at: string
}

export type ScrapeSloSnapshot = {
  sampleSize: number
  succeeded: number
  failed: number
  successRate: number | null
  durationSampleSize: number
  p50Minutes: number | null
  p95Minutes: number | null
  startSampleSize: number
  p50StartSeconds: number | null
  p95StartSeconds: number | null
  processingSampleSize: number
  p50ProcessingMinutes: number | null
  p95ProcessingMinutes: number | null
  p50WorkerInvocations: number | null
  p95WorkerInvocations: number | null
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

export function buildScrapeSloSnapshot(
  rows: ScrapeSloRow[],
  claimRows: ScrapeClaimRow[] = []
): ScrapeSloSnapshot {
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
  const claimsByScrape = new Map<string, number[]>()
  for (const claim of claimRows) {
    if (!claim.scrape_id) continue
    const claimedAt = Date.parse(claim.created_at)
    if (!Number.isFinite(claimedAt)) continue
    const claims = claimsByScrape.get(claim.scrape_id) ?? []
    claims.push(claimedAt)
    claimsByScrape.set(claim.scrape_id, claims)
  }
  const starts: number[] = []
  const processingDurations: number[] = []
  const workerInvocations: number[] = []
  for (const row of rows) {
    if (!row.id) continue
    const claims = claimsByScrape.get(row.id)
    if (!claims?.length) continue
    const startedAt = Date.parse(row.started_at)
    const firstClaimedAt = Math.min(...claims)
    if (Number.isFinite(startedAt) && firstClaimedAt >= startedAt) {
      starts.push((firstClaimedAt - startedAt) / 1000)
    }
    if (row.status === "completed" && row.completed_at) {
      const completedAt = Date.parse(row.completed_at)
      if (Number.isFinite(completedAt) && completedAt >= firstClaimedAt) {
        processingDurations.push((completedAt - firstClaimedAt) / 60000)
      }
    }
    workerInvocations.push(claims.length)
  }
  const p50Start = percentile(starts, 50)
  const p95Start = percentile(starts, 95)
  const p50Processing = percentile(processingDurations, 50)
  const p95Processing = percentile(processingDurations, 95)
  const p50Invocations = percentile(workerInvocations, 50)
  const p95Invocations = percentile(workerInvocations, 95)
  return {
    sampleSize,
    succeeded,
    failed,
    successRate: sampleSize > 0 ? round((succeeded / sampleSize) * 100) : null,
    durationSampleSize: durations.length,
    p50Minutes: p50 === null ? null : round(p50),
    p95Minutes: p95 === null ? null : round(p95),
    startSampleSize: starts.length,
    p50StartSeconds: p50Start === null ? null : round(p50Start),
    p95StartSeconds: p95Start === null ? null : round(p95Start),
    processingSampleSize: processingDurations.length,
    p50ProcessingMinutes: p50Processing === null ? null : round(p50Processing),
    p95ProcessingMinutes: p95Processing === null ? null : round(p95Processing),
    p50WorkerInvocations: p50Invocations,
    p95WorkerInvocations: p95Invocations,
  }
}
