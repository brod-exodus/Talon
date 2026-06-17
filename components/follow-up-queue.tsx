"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { CalendarClock, Loader2, RefreshCw } from "lucide-react"
import {
  ContributorQuickPreview,
  prefetchContributorPreview,
  type ContributorPreviewSummary,
} from "@/components/contributor-quick-preview"
import {
  ProjectOutreachBadge,
  type ProjectContributorTracking,
} from "@/components/project-outreach"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type FollowUpQueueItem = {
  tracking: ProjectContributorTracking
  contributor: {
    id: string
    username: string
    name: string
    avatar: string
    bio: string | null
    location: string | null
    company: string | null
    contacts: {
      email?: string
      twitter?: string
      linkedin?: string
      website?: string
      github?: string
    }
  }
  project: {
    id: string
    name: string
  }
}

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(date: string | null) {
  if (!date) return "No date"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`))
}

function dueLabel(date: string | null) {
  if (!date) return "Due"
  const today = todayString()
  if (date === today) return "Due today"
  if (date < today) return "Overdue"
  return "Upcoming"
}

function toPreviewSummary(item: FollowUpQueueItem): ContributorPreviewSummary {
  return {
    id: item.contributor.id,
    username: item.contributor.username,
    name: item.contributor.name,
    avatar: item.contributor.avatar,
    bio: item.contributor.bio,
    location: item.contributor.location,
    company: item.contributor.company,
    contacts: item.contributor.contacts,
    projects: [item.project],
  }
}

export function FollowUpQueue() {
  const [followUps, setFollowUps] = useState<FollowUpQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [previewItem, setPreviewItem] = useState<FollowUpQueueItem | null>(null)
  const previewPrefetchTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const cancelPreviewPrefetch = useCallback((contributorId: string) => {
    const timeout = previewPrefetchTimers.current.get(contributorId)
    if (!timeout) return
    clearTimeout(timeout)
    previewPrefetchTimers.current.delete(contributorId)
  }, [])

  const schedulePreviewPrefetch = useCallback((item: FollowUpQueueItem) => {
    cancelPreviewPrefetch(item.contributor.id)
    const timeout = setTimeout(() => {
      previewPrefetchTimers.current.delete(item.contributor.id)
      prefetchContributorPreview(item.contributor.id, item.project.id)
    }, 150)
    previewPrefetchTimers.current.set(item.contributor.id, timeout)
  }, [cancelPreviewPrefetch])

  useEffect(() => {
    const timers = previewPrefetchTimers.current
    return () => {
      for (const timeout of timers.values()) clearTimeout(timeout)
      timers.clear()
    }
  }, [])

  const loadFollowUps = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/follow-ups", { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Follow-ups could not load")
      setFollowUps(Array.isArray(data?.followUps) ? data.followUps : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Follow-ups could not load")
      setFollowUps([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFollowUps()
  }, [loadFollowUps])

  const projectOptions = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>()
    for (const item of followUps) byId.set(item.project.id, item.project)
    if (previewItem) byId.set(previewItem.project.id, previewItem.project)
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [followUps, previewItem])
  const previewItems = followUps.slice(0, 3)

  return (
    <>
      <Card className="overflow-hidden border-border bg-card shadow-none ">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">Outreach</p>
            <CardTitle className="mt-1 flex items-center gap-2 text-2xl font-extrabold">
              <CalendarClock className="h-5 w-5 text-primary" />
              Follow-Ups Due
            </CardTitle>
            {!loading && (
              <p className="mt-1 text-sm font-semibold text-muted-foreground">
                {followUps.length} due today or overdue
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={loadFollowUps} disabled={loading} className="bg-card">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
            <Button asChild size="sm">
              <Link href="/pipeline">View Pipeline</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-4 py-5 text-sm font-semibold text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading due follow-ups...
            </div>
          ) : followUps.length === 0 ? (
            <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-4 py-5 text-sm font-medium text-emerald-300">
              No follow-ups due. You&apos;re clear.
            </div>
          ) : (
            <div className="space-y-3">
              {previewItems.map((item) => (
                  <div
                    key={item.tracking.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPreviewItem(item)}
                    onMouseEnter={() => schedulePreviewPrefetch(item)}
                    onMouseLeave={() => cancelPreviewPrefetch(item.contributor.id)}
                    onFocus={() => schedulePreviewPrefetch(item)}
                    onBlur={() => cancelPreviewPrefetch(item.contributor.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        setPreviewItem(item)
                      }
                    }}
                    className="w-full cursor-pointer rounded-lg border border-border bg-card p-4 text-left shadow-none transition hover:-translate-y-0.5 hover:border-primary/20 hover:bg-muted/30"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <img
                          src={item.contributor.avatar || "/placeholder.svg?height=48&width=48"}
                          alt={item.contributor.name}
                          className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-border"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-extrabold text-foreground">{item.contributor.name}</p>
                            <span className="font-mono text-xs font-semibold text-muted-foreground">@{item.contributor.username}</span>
                            <ProjectOutreachBadge status={item.tracking.status} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                            <Link
                              href={`/ecosystems/${item.project.id}`}
                              onClick={(event) => event.stopPropagation()}
                              className="text-primary hover:underline"
                            >
                              {item.project.name}
                            </Link>
                            <span>/</span>
                            <Badge variant={item.tracking.nextFollowUpAt === todayString() ? "secondary" : "outline"} className="bg-card">
                              {dueLabel(item.tracking.nextFollowUpAt)}: {formatDate(item.tracking.nextFollowUpAt)}
                            </Badge>
                          </div>
                          {item.tracking.notes && (
                            <p className="mt-2 line-clamp-2 text-xs font-medium leading-relaxed text-muted-foreground">
                              {item.tracking.notes}
                            </p>
                          )}
                        </div>
                      </div>

                      <Button asChild size="sm" variant="outline" className="w-fit bg-card" onClick={(event) => event.stopPropagation()}>
                        <Link href="/pipeline">Work in Pipeline</Link>
                      </Button>
                    </div>
                  </div>
                ))}
              {followUps.length > previewItems.length && (
                <Button asChild variant="outline" className="w-full bg-card">
                  <Link href="/pipeline">View all {followUps.length} follow-ups</Link>
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <ContributorQuickPreview
        open={Boolean(previewItem)}
        contributor={previewItem ? toPreviewSummary(previewItem) : null}
        onOpenChange={(open) => {
          if (!open) setPreviewItem(null)
        }}
        currentProject={previewItem?.project ?? null}
        currentProjectTracking={previewItem?.tracking ?? null}
        projectOptions={projectOptions}
        canSaveToList={false}
        canUpdateProjectTracking={false}
      />
    </>
  )
}
