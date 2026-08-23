import type { ScrapeJobEventRow } from "@/lib/db"
import { classifyScrapeFailure, type ScrapeFailureCode } from "./scrape-failure-diagnostic.ts"

export type ScrapeJobTimelineEvent = {
  id: string
  eventType: string
  label: string
  category: "queue" | "worker" | "progress" | "retry" | "terminal"
  occurredAt: string
  detail: string | null
  failureCode: ScrapeFailureCode | null
  guidance: string | null
}

const EVENT_PRESENTATION: Record<string, Pick<ScrapeJobTimelineEvent, "label" | "category">> = {
  queued: { label: "Queued for processing", category: "queue" },
  claimed: { label: "Worker started an attempt", category: "worker" },
  started: { label: "Scrape execution started", category: "worker" },
  hydrate_started: { label: "Contributor enrichment started", category: "progress" },
  contributors_persisted: { label: "Contributor batch saved", category: "progress" },
  cached_contributors_linked: { label: "Fresh cached profiles reused", category: "progress" },
  repository_discovered: { label: "Repository contributors discovered", category: "progress" },
  organization_page_discovered: { label: "Organization repositories discovered", category: "progress" },
  yielded: { label: "Work saved for the next invocation", category: "worker" },
  requeued: { label: "Work saved for the next invocation", category: "worker" },
  retry_scheduled: { label: "Retry scheduled", category: "retry" },
  stale_lock_recovered: { label: "Interrupted work recovered", category: "retry" },
  worker_lease_lost: { label: "Worker handoff detected", category: "retry" },
  succeeded: { label: "Scrape completed", category: "terminal" },
  failed: { label: "Scrape stopped after repeated failures", category: "terminal" },
  canceled: { label: "Scrape canceled", category: "terminal" },
}

function finiteInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null
}

function safeDetail(eventType: string, metadata: Record<string, unknown>): string | null {
  const attempt = finiteInteger(metadata.attempt)
  const maxAttempts = finiteInteger(metadata.maxAttempts)
  const persisted = finiteInteger(metadata.persistedCount ?? metadata.persisted)
  const processed = finiteInteger(metadata.processedCount ?? metadata.processed)
  const candidate = finiteInteger(metadata.candidateCount ?? metadata.candidates)
  const retryDelayMs = finiteInteger(metadata.retryDelayMs)
  const parts: string[] = []

  if (attempt !== null) parts.push(maxAttempts !== null ? `attempt ${attempt} of ${maxAttempts}` : `attempt ${attempt}`)
  if (eventType === "contributors_persisted" && persisted !== null) {
    parts.push(`${persisted.toLocaleString("en-US")} contributors saved`)
  } else if (processed !== null && candidate !== null) {
    parts.push(`${processed.toLocaleString("en-US")} of ${candidate.toLocaleString("en-US")} processed`)
  }
  if (eventType === "retry_scheduled" && retryDelayMs !== null) {
    parts.push(`retry in ${Math.max(1, Math.ceil(retryDelayMs / 1000))} seconds`)
  }

  return parts.length > 0 ? parts.join(" · ") : null
}

export function toScrapeJobTimelineEvent(row: ScrapeJobEventRow): ScrapeJobTimelineEvent {
  const presentation = EVENT_PRESENTATION[row.event_type] ?? {
    label: "Processing activity recorded",
    category: "progress" as const,
  }
  const failure = row.event_type === "failed" || row.event_type === "retry_scheduled"
    ? classifyScrapeFailure({ message: row.message, metadata: row.metadata })
    : null
  const context = safeDetail(row.event_type, row.metadata ?? {})
  return {
    id: row.id,
    eventType: row.event_type,
    label: presentation.label,
    category: presentation.category,
    occurredAt: row.created_at,
    detail: failure ? [failure.summary, context].filter(Boolean).join(" · ") : context,
    failureCode: failure?.code ?? null,
    guidance: failure?.guidance ?? null,
  }
}
