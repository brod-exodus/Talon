"use client"

import { useEffect, useState, memo, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Activity, Users, Clock, AlertTriangle, RotateCw, XCircle } from "lucide-react"
import { motion } from "framer-motion"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

type ScrapeJobSummary = {
  id: string
  status: "queued" | "running" | "succeeded" | "failed" | "canceled"
  attempts: number
  maxAttempts: number
  runAfter: string
  lockedAt: string | null
  lastError: string | null
}

type ActiveScrape = {
  id: string
  target: string
  type: string
  progress: number
  current: number
  total: number
  currentUser?: string
  startedAt: Date
  job?: ScrapeJobSummary
}

type ActiveScrapesProps = {
  onScrapeCompleted?: () => void
}

export const ActiveScrapes = memo(function ActiveScrapes({ onScrapeCompleted }: ActiveScrapesProps) {
  const [scrapes, setScrapes] = useState<ActiveScrape[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [canceling, setCanceling] = useState<Set<string>>(new Set())
  const [retrying, setRetrying] = useState<Set<string>>(new Set())
  const { toast } = useToast()
  // Track whether we had active scrapes on the previous poll so we can detect
  // the non-empty → empty transition that signals a scrape just completed.
  const hadScrapesRef = useRef(false)

  useEffect(() => {
    const fetchScrapes = async () => {
      try {
        const response = await fetch("/api/scrapes")
        const data = await response.json()
        const active: ActiveScrape[] = data.active || []
        setScrapes(active)

        // Fire callback when the list goes from having items to empty.
        if (hadScrapesRef.current && active.length === 0) {
          onScrapeCompleted?.()
        }
        hadScrapesRef.current = active.length > 0
      } catch (error) {
        console.error("[v0] Failed to fetch scrapes:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchScrapes()
    const interval = setInterval(fetchScrapes, 2000)
    return () => clearInterval(interval)
  }, [onScrapeCompleted])

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000)
    if (seconds < 60) return `${seconds} seconds ago`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
    const hours = Math.floor(minutes / 60)
    return `${hours} hour${hours > 1 ? "s" : ""} ago`
  }

  const getJobLabel = (scrape: ActiveScrape) => {
    if (!scrape.job) return "Processing"
    if (scrape.job.status === "queued" && scrape.job.attempts > 0) return "Retrying"
    if (scrape.job.status === "queued") return "Queued"
    if (scrape.job.status === "running") return "Running"
    if (scrape.job.status === "failed") return "Failed"
    if (scrape.job.status === "canceled") return "Canceled"
    return "Processing"
  }

  const getProgressLabel = (scrape: ActiveScrape) => {
    if (!scrape.job) return "Processing contributors"
    if (scrape.job.status === "queued") return "Waiting for worker"
    return "Processing contributors"
  }

  const cancelJob = async (jobId: string) => {
    setCanceling((prev) => new Set(prev).add(jobId))
    try {
      const response = await fetch(`/api/scrape-jobs/${jobId}/cancel`, { method: "POST" })
      if (!response.ok) throw new Error("Failed to cancel scrape")
      toast({ title: "Scrape canceled", description: "The worker will stop this scrape at its next checkpoint." })
    } catch (error) {
      toast({
        title: "Cancel failed",
        description: error instanceof Error ? error.message : "Unable to cancel scrape",
        variant: "destructive",
      })
    } finally {
      setCanceling((prev) => {
        const next = new Set(prev)
        next.delete(jobId)
        return next
      })
    }
  }

  const retryJob = async (jobId: string) => {
    setRetrying((prev) => new Set(prev).add(jobId))
    try {
      const response = await fetch(`/api/scrape-jobs/${jobId}/retry`, { method: "POST" })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to retry scrape")
      }
      toast({ title: "Retry started", description: "The scrape worker has been kicked off again." })
    } catch (error) {
      toast({
        title: "Retry failed",
        description: error instanceof Error ? error.message : "Unable to retry scrape",
        variant: "destructive",
      })
    } finally {
      setRetrying((prev) => {
        const next = new Set(prev)
        next.delete(jobId)
        return next
      })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Card className="border-border bg-card">
          <CardHeader>
            <Skeleton className="h-6 w-48 mb-2" />
            <Skeleton className="h-4 w-32" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-2 w-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (scrapes.length === 0) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-primary" />
        <h2 className="text-2xl font-semibold tracking-tight">Active Scrapes</h2>
      </div>

      <div className="space-y-4">
        {scrapes.map((scrape, index) => (
          <motion.div
            key={scrape.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
          >
            <Card className="border-border bg-card hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-xl font-mono">{scrape.target}</CardTitle>
                    <CardDescription className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20">
                        {scrape.type}
                      </Badge>
                      <span className="flex items-center gap-1 text-xs">
                        <Clock className="w-3 h-3" />
                        {formatTimeAgo(scrape.startedAt)}
                      </span>
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="bg-chart-2/10 text-chart-2 border-chart-2/20">
                    {getJobLabel(scrape)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      {getProgressLabel(scrape)}
                    </span>
                    <motion.span
                      key={Math.round(scrape.progress)}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2 }}
                      className="font-mono text-foreground"
                    >
                      {Math.round(scrape.progress)}%
                    </motion.span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.min(100, Math.max(0, scrape.progress))}%`,
                        transition: "width 0.5s ease-in-out",
                      }}
                    />
                  </div>
                </div>

                {scrape.currentUser && (
                  <div className="pt-2 border-t border-border">
                    <motion.p
                      key={scrape.currentUser}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-sm text-muted-foreground"
                    >
                      Current: <span className="font-mono text-foreground">{scrape.currentUser}</span>
                    </motion.p>
                  </div>
                )}
                {scrape.job?.lastError && (
                  <div className="flex gap-2 rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{scrape.job.lastError}</span>
                  </div>
                )}
                {scrape.job && scrape.job.status === "queued" && scrape.job.attempts > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Retry {scrape.job.attempts}/{scrape.job.maxAttempts} scheduled for{" "}
                    {new Date(scrape.job.runAfter).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
                  </p>
                )}
                {scrape.job && scrape.job.status !== "failed" && scrape.job.status !== "canceled" && (
                  <div className="flex justify-end gap-2">
                    {scrape.job.status === "queued" && scrape.job.attempts > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="bg-transparent"
                        disabled={retrying.has(scrape.job.id)}
                        onClick={() => retryJob(scrape.job!.id)}
                      >
                        <RotateCw className="w-4 h-4 mr-2" />
                        Retry
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-transparent"
                      disabled={canceling.has(scrape.job.id)}
                      onClick={() => cancelJob(scrape.job!.id)}
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      Cancel
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
})
