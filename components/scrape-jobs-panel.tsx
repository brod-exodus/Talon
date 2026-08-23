"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, ChevronDown, ChevronUp, Clock, RotateCw, ServerCog, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { useAuthPermissions } from "@/lib/client-permissions"

type ScrapeJobSummary = {
  id: string
  scrapeId: string
  type: "organization" | "repository"
  target: string
  status: "queued" | "running" | "succeeded" | "failed" | "canceled"
  attempts: number
  maxAttempts: number
  runAfter: string
  lockedAt: string | null
  lockedBy: string | null
  lastError: string | null
  cancelRequested: boolean
  recentEvents?: Array<{
    id: string
    eventType: string
    label: string
    category: "queue" | "worker" | "progress" | "retry" | "terminal"
    occurredAt: string
    detail: string | null
  }>
  updatedAt: string
}

function formatTime(date: string | null): string {
  if (!date) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date))
}

function statusBadge(job: ScrapeJobSummary) {
  if (job.status === "failed") {
    return <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">Failed</Badge>
  }
  if (job.status === "running") {
    return <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-400">Running</Badge>
  }
  if (job.status === "canceled") {
    return <Badge variant="outline" className="border-muted-foreground/30 bg-muted/40 text-muted-foreground">Canceled</Badge>
  }
  if (job.status === "queued" && job.attempts > 0) {
    return <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400">Retrying</Badge>
  }
  if (job.status === "queued") {
    return <Badge variant="outline">Queued</Badge>
  }
  return <Badge variant="secondary">Succeeded</Badge>
}

function isTimelineEvent(value: unknown): value is NonNullable<ScrapeJobSummary["recentEvents"]>[number] {
  if (!value || typeof value !== "object") return false
  const event = value as Record<string, unknown>
  return typeof event.id === "string"
    && typeof event.eventType === "string"
    && typeof event.label === "string"
    && ["queue", "worker", "progress", "retry", "terminal"].includes(String(event.category))
    && typeof event.occurredAt === "string"
    && (event.detail === null || typeof event.detail === "string")
}

export function ScrapeJobsPanel() {
  const { canAdmin } = useAuthPermissions()
  const [jobs, setJobs] = useState<ScrapeJobSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
  const [retrying, setRetrying] = useState<Set<string>>(new Set())
  const [canceling, setCanceling] = useState<Set<string>>(new Set())
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [timelines, setTimelines] = useState<Record<string, NonNullable<ScrapeJobSummary["recentEvents"]>>>({})
  const [timelineLoading, setTimelineLoading] = useState<Set<string>>(new Set())
  const [timelineErrors, setTimelineErrors] = useState<Record<string, string>>({})
  const { toast } = useToast()

  const visibleJobs = useMemo(
    () => jobs.slice(0, 8),
    [jobs]
  )

  const loadJobs = useCallback(async () => {
    if (!canAdmin) {
      setJobs([])
      setLoading(false)
      return
    }

    try {
      const res = await fetch("/api/scrape-jobs", { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(
          data && typeof data.error === "string"
            ? data.error
            : "Scrape operations could not load"
        )
      }
      if (!data || !Array.isArray(data.jobs)) {
        throw new Error("Scrape operations returned an invalid response")
      }
      setJobs(data.jobs)
      setLoadError(null)
      setLastLoadedAt(new Date())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Scrape operations could not load")
    } finally {
      setLoading(false)
    }
  }, [canAdmin])

  useEffect(() => {
    if (!canAdmin) {
      setJobs([])
      setLoading(false)
      return
    }

    loadJobs()
    const interval = setInterval(loadJobs, 5000)
    return () => clearInterval(interval)
  }, [canAdmin, loadJobs])

  const retryJob = useCallback(async (jobId: string) => {
    if (!canAdmin) return
    setRetrying((prev) => new Set(prev).add(jobId))
    try {
      const res = await fetch(`/api/scrape-jobs/${jobId}/retry`, { method: "POST" })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data && typeof data.error === "string" ? data.error : "Failed to retry job")
      }
      toast({ title: "Retry queued", description: "The scrape will run again shortly." })
      await loadJobs()
    } catch (error) {
      toast({
        title: "Retry failed",
        description: error instanceof Error ? error.message : "Unable to retry scrape job",
        variant: "destructive",
      })
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev)
        next.delete(jobId)
        return next
      })
    }
  }, [canAdmin, loadJobs, toast])

  const cancelJob = useCallback(async (jobId: string) => {
    if (!canAdmin) return
    setCanceling((prev) => new Set(prev).add(jobId))
    try {
      const res = await fetch(`/api/scrape-jobs/${jobId}/cancel`, { method: "POST" })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(data && typeof data.error === "string" ? data.error : "Failed to cancel job")
      }
      toast({ title: "Processing canceled", description: "The scrape will stop safely shortly." })
      await loadJobs()
    } catch (error) {
      toast({
        title: "Cancel failed",
        description: error instanceof Error ? error.message : "Unable to cancel scrape job",
        variant: "destructive",
      })
    } finally {
      setCanceling((prev) => {
        const next = new Set(prev)
        next.delete(jobId)
        return next
      })
    }
  }, [canAdmin, loadJobs, toast])

  const loadTimeline = useCallback(async (jobId: string) => {
    setTimelineLoading((previous) => new Set(previous).add(jobId))
    setTimelineErrors((previous) => {
      const next = { ...previous }
      delete next[jobId]
      return next
    })
    try {
      const response = await fetch(`/api/scrape-jobs/${jobId}/events`, { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data && typeof data.error === "string" ? data.error : "Timeline could not load")
      }
      if (!data || !Array.isArray(data.events) || !data.events.every(isTimelineEvent)) {
        throw new Error("Timeline returned an invalid response")
      }
      setTimelines((previous) => ({ ...previous, [jobId]: data.events }))
    } catch (error) {
      setTimelineErrors((previous) => ({
        ...previous,
        [jobId]: error instanceof Error ? error.message : "Timeline could not load",
      }))
    } finally {
      setTimelineLoading((previous) => {
        const next = new Set(previous)
        next.delete(jobId)
        return next
      })
    }
  }, [])

  const toggleTimeline = useCallback((jobId: string) => {
    if (expandedJobId === jobId) {
      setExpandedJobId(null)
      return
    }
    setExpandedJobId(jobId)
    if (!timelines[jobId]) void loadTimeline(jobId)
  }, [expandedJobId, loadTimeline, timelines])

  if (!canAdmin) return null
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ServerCog className="w-5 h-5 text-primary" />
        <h2 className="text-2xl font-semibold tracking-tight">Scrape Operations</h2>
      </div>
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Recent Processing Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadError && (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <div className="flex min-w-0 items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">Scrape operations could not refresh</p>
                  <p className="break-words text-xs text-muted-foreground">{loadError}</p>
                  {lastLoadedAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Showing the last update from {lastLoadedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
                    </p>
                  )}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={loadJobs}>
                <RotateCw className="mr-1 h-3 w-3" />
                Retry
              </Button>
            </div>
          )}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading jobs...</p>
          ) : visibleJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scrape processing history yet.</p>
          ) : visibleJobs.map((job) => (
            <div key={job.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm text-foreground">{job.target}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.type} · attempt {job.attempts}/{job.maxAttempts}
                  </p>
                </div>
                {statusBadge(job)}
              </div>
              {job.lastError && (
                <div className="flex gap-2 rounded-md bg-destructive/10 border border-destructive/20 p-2 text-xs text-destructive">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span className="break-words">{job.lastError}</span>
                </div>
              )}
              {job.recentEvents && job.recentEvents.length > 0 && expandedJobId !== job.id && (
                <div className="space-y-1 rounded-md border border-border bg-muted/20 p-2">
                  {job.recentEvents.slice(0, 3).map((event) => (
                    <div key={event.id} className="flex items-start justify-between gap-3 text-xs">
                      <span className="min-w-0 text-muted-foreground">
                        <span className="break-words text-foreground/80">{event.label}</span>
                        {event.detail && <span> · {event.detail}</span>}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{formatTime(event.occurredAt)}</span>
                    </div>
                  ))}
                </div>
              )}
              {expandedJobId === job.id && (
                <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                  <p className="text-xs font-medium text-foreground">Execution timeline</p>
                  {timelineLoading.has(job.id) ? (
                    <p className="text-xs text-muted-foreground">Loading timeline...</p>
                  ) : timelineErrors[job.id] ? (
                    <div className="flex items-center justify-between gap-3 text-xs text-destructive">
                      <span>{timelineErrors[job.id]}</span>
                      <Button size="sm" variant="outline" className="h-7" onClick={() => {
                        setTimelines((previous) => {
                          const next = { ...previous }
                          delete next[job.id]
                          return next
                        })
                        void loadTimeline(job.id)
                      }}>Retry</Button>
                    </div>
                  ) : (timelines[job.id] ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No timeline events were recorded.</p>
                  ) : (
                    <ol className="space-y-2 border-l border-border pl-3">
                      {(timelines[job.id] ?? []).map((event) => (
                        <li key={event.id} className="text-xs">
                          <div className="flex items-start justify-between gap-3">
                            <span className="font-medium text-foreground">{event.label}</span>
                            <time className="shrink-0 text-muted-foreground">{formatTime(event.occurredAt)}</time>
                          </div>
                          {event.detail && <p className="text-muted-foreground">{event.detail}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Next attempt {formatTime(job.runAfter)}
                </span>
                {canAdmin && (
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      onClick={() => toggleTimeline(job.id)}
                    >
                      {expandedJobId === job.id ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
                      Timeline
                    </Button>
                    {(job.status === "queued" || job.status === "running") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 bg-transparent"
                        disabled={canceling.has(job.id)}
                        onClick={() => cancelJob(job.id)}
                      >
                        <XCircle className="w-3 h-3 mr-1" />
                        Cancel
                      </Button>
                    )}
                    {(job.status === "failed" || job.status === "canceled") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 bg-transparent"
                        disabled={retrying.has(job.id)}
                        onClick={() => retryJob(job.id)}
                      >
                        <RotateCw className={`w-3 h-3 mr-1 ${retrying.has(job.id) ? "animate-spin" : ""}`} />
                        Retry
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
