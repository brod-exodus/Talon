"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Archive, CalendarClock, CheckCircle2, Loader2, RefreshCw } from "lucide-react"
import { ContributorQuickPreview, type ContributorPreviewSummary } from "@/components/contributor-quick-preview"
import {
  ProjectOutreachBadge,
  type ProjectContributorTracking,
  type ProjectOutreachStatus,
  type ProjectTrackingUpdate,
} from "@/components/project-outreach"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { useAuthPermissions } from "@/lib/client-permissions"

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

function addDays(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
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
  const { canWrite } = useAuthPermissions()
  const { toast } = useToast()
  const [followUps, setFollowUps] = useState<FollowUpQueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [previewItem, setPreviewItem] = useState<FollowUpQueueItem | null>(null)

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

  async function updateTracking(item: FollowUpQueueItem, updates: ProjectTrackingUpdate) {
    if (!canWrite) return null
    setSavingIds((prev) => new Set(prev).add(item.tracking.id))
    setError(null)
    try {
      const response = await fetch(`/api/ecosystems/${item.project.id}/tracking`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contributorId: item.contributor.id, ...updates }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Follow-up could not be updated")
      const tracking = data.tracking as ProjectContributorTracking
      const nextItem = { ...item, tracking }
      const remainsDue =
        Boolean(tracking.nextFollowUpAt) &&
        tracking.nextFollowUpAt! <= todayString() &&
        tracking.status !== "archived" &&
        tracking.status !== "rejected"

      setFollowUps((prev) =>
        remainsDue
          ? prev.map((current) => (current.tracking.id === item.tracking.id ? nextItem : current))
          : prev.filter((current) => current.tracking.id !== item.tracking.id)
      )
      setPreviewItem((current) => (current?.tracking.id === item.tracking.id ? nextItem : current))
      return tracking
    } catch (err) {
      const message = err instanceof Error ? err.message : "Follow-up could not be updated"
      setError(message)
      toast({ title: "Could not update follow-up", description: message, variant: "destructive" })
      return null
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev)
        next.delete(item.tracking.id)
        return next
      })
    }
  }

  async function markFollowedUp(item: FollowUpQueueItem) {
    const tracking = await updateTracking(item, {
      lastContactedAt: todayString(),
      nextFollowUpAt: null,
    })
    if (tracking) toast({ title: "Follow-up cleared", description: `${item.contributor.name} was marked followed up.` })
  }

  async function snooze(item: FollowUpQueueItem, days: number) {
    const tracking = await updateTracking(item, { nextFollowUpAt: addDays(days) })
    if (tracking) toast({ title: "Follow-up snoozed", description: `${item.contributor.name} is due ${formatDate(tracking.nextFollowUpAt)}.` })
  }

  async function archive(item: FollowUpQueueItem) {
    const tracking = await updateTracking(item, { status: "archived" as ProjectOutreachStatus })
    if (tracking) toast({ title: "Contributor archived", description: `${item.contributor.name} was archived for this Project.` })
  }

  return (
    <>
      <Card className="overflow-hidden border-white/70 bg-white/80 shadow-sm shadow-indigo-500/5 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">Outreach</p>
            <CardTitle className="mt-1 flex items-center gap-2 text-2xl font-extrabold">
              <CalendarClock className="h-5 w-5 text-primary" />
              Follow-Up Queue
            </CardTitle>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={loadFollowUps} disabled={loading} className="bg-white/70">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-5 text-sm font-semibold text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading due follow-ups...
            </div>
          ) : followUps.length === 0 ? (
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-5 text-sm font-semibold text-emerald-700">
              No follow-ups due. You&apos;re clear.
            </div>
          ) : (
            <div className="space-y-3">
              {followUps.map((item) => {
                const saving = savingIds.has(item.tracking.id)
                return (
                  <div
                    key={item.tracking.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setPreviewItem(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        setPreviewItem(item)
                      }
                    }}
                    className="w-full cursor-pointer rounded-3xl border border-white/70 bg-white/75 p-4 text-left shadow-sm shadow-indigo-500/5 transition hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-md hover:shadow-indigo-500/10"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <img
                          src={item.contributor.avatar || "/placeholder.svg?height=48&width=48"}
                          alt={item.contributor.name}
                          className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-white"
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
                            <Badge variant={item.tracking.nextFollowUpAt === todayString() ? "secondary" : "outline"} className="bg-white/70">
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

                      {canWrite && (
                        <div className="flex flex-wrap gap-2 lg:justify-end" onClick={(event) => event.stopPropagation()}>
                          <Button type="button" size="sm" onClick={() => markFollowedUp(item)} disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                            Mark Followed Up
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => snooze(item, 3)} disabled={saving} className="bg-white/80">
                            Snooze 3 days
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => snooze(item, 7)} disabled={saving} className="bg-white/80">
                            Snooze 1 week
                          </Button>
                          <Button type="button" size="sm" variant="outline" onClick={() => archive(item)} disabled={saving} className="bg-white/80">
                            <Archive className="h-4 w-4" />
                            Archive
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
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
        canSaveToList={canWrite}
        canUpdateProjectTracking={canWrite}
        trackingSaving={previewItem ? savingIds.has(previewItem.tracking.id) : false}
        onUpdateProjectTracking={async (contributorId, updates) => {
          if (!previewItem || contributorId !== previewItem.contributor.id) return null
          return updateTracking(previewItem, updates)
        }}
      />
    </>
  )
}
