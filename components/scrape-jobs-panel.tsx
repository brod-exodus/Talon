"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Clock, RotateCw, ServerCog, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

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
    message: string
    createdAt: string
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

export function ScrapeJobsPanel() {
  const [jobs, setJobs] = useState<ScrapeJobSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState<Set<string>>(new Set())
  const [canceling, setCanceling] = useState<Set<string>>(new Set())
  const { toast } = useToast()

  const visibleJobs = useMemo(
    () => jobs.filter((job) => job.status !== "succeeded").slice(0, 8),
    [jobs]
  )

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/scrape-jobs")
      if (!res.ok) throw new Error("Failed to fetch jobs")
      const data = await res.json()
      setJobs(data.jobs ?? [])
    } catch (error) {
      console.error("[scrape-jobs] fetch error:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadJobs()
    const interval = setInterval(loadJobs, 5000)
    return () => clearInterval(interval)
  }, [loadJobs])

  const retryJob = useCallback(async (jobId: string) => {
    setRetrying((prev) => new Set(prev).add(jobId))
    try {
      const res = await fetch(`/api/scrape-jobs/${jobId}/retry`, { method: "POST" })
      if (!res.ok) throw new Error("Failed to retry job")
      toast({ title: "Job queued", description: "The scrape job will run on the next worker tick." })
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
  }, [loadJobs, toast])

  const cancelJob = useCallback(async (jobId: string) => {
    setCanceling((prev) => new Set(prev).add(jobId))
    try {
      const res = await fetch(`/api/scrape-jobs/${jobId}/cancel`, { method: "POST" })
      if (!res.ok) throw new Error("Failed to cancel job")
      toast({ title: "Job canceled", description: "The scrape will stop at its next checkpoint." })
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
  }, [loadJobs, toast])

  if (!loading && visibleJobs.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ServerCog className="w-5 h-5 text-primary" />
        <h2 className="text-2xl font-semibold tracking-tight">Scrape Jobs</h2>
      </div>
      <Card className="border-border bg-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Worker Queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading jobs...</p>
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
              {job.recentEvents && job.recentEvents.length > 0 && (
                <div className="space-y-1 rounded-md border border-border bg-muted/20 p-2">
                  {job.recentEvents.slice(0, 3).map((event) => (
                    <div key={event.id} className="flex items-start justify-between gap-3 text-xs">
                      <span className="min-w-0 text-muted-foreground">
                        <span className="font-mono text-foreground/80">{event.eventType}</span>
                        {" · "}
                        <span className="break-words">{event.message}</span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">{formatTime(event.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Next run {formatTime(job.runAfter)}
                </span>
                <div className="flex items-center gap-2">
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
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
