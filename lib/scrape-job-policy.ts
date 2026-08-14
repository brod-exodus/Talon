export const MIN_SCRAPE_RETRY_DELAY_MS = 60 * 1000
export const MAX_SCRAPE_RETRY_DELAY_MINUTES = 60

export type ScrapeJobFailurePlan = {
  status: "queued" | "failed"
  runAfter: string
  retryDelayMs: number | null
}

export function planGitHubCooldownUntil(retryAfterMs: number | undefined, now = Date.now()): string {
  const requestedDelay = retryAfterMs !== undefined && Number.isFinite(retryAfterMs)
    ? Math.max(MIN_SCRAPE_RETRY_DELAY_MS, retryAfterMs)
    : MIN_SCRAPE_RETRY_DELAY_MS
  return new Date(now + requestedDelay).toISOString()
}

export function planScrapeJobFailure({
  attempts,
  maxAttempts,
  currentRunAfter,
  retryAfterMs,
  now = Date.now(),
}: {
  attempts: number
  maxAttempts: number
  currentRunAfter: string
  retryAfterMs?: number
  now?: number
}): ScrapeJobFailurePlan {
  if (attempts >= maxAttempts) {
    return { status: "failed", runAfter: currentRunAfter, retryDelayMs: null }
  }

  const requestedDelay =
    retryAfterMs !== undefined && Number.isFinite(retryAfterMs)
      ? Math.max(MIN_SCRAPE_RETRY_DELAY_MS, retryAfterMs)
      : Math.min(MAX_SCRAPE_RETRY_DELAY_MINUTES, 2 ** Math.max(0, attempts)) * 60 * 1000

  return {
    status: "queued",
    runAfter: new Date(now + requestedDelay).toISOString(),
    retryDelayMs: requestedDelay,
  }
}

export function planStaleScrapeJobRecovery({
  attempts,
  maxAttempts,
  cancelRequested,
}: {
  attempts: number
  maxAttempts: number
  cancelRequested: boolean
}): "queued" | "failed" | "canceled" {
  if (cancelRequested) return "canceled"
  if (attempts >= maxAttempts) return "failed"
  return "queued"
}

export function isScrapeJobCancellationRequested(
  control: { status: string; cancel_requested: boolean } | null | undefined
): boolean {
  return Boolean(control?.cancel_requested || control?.status === "canceled")
}
