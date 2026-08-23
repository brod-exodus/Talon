"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Archive, CalendarClock, CheckCircle2, ExternalLink, Loader2, Search } from "lucide-react"
import {
  ContributorQuickPreview,
  prefetchContributorPreview,
  type ContributorPreviewSummary,
} from "@/components/contributor-quick-preview"
import {
  PROJECT_OUTREACH_STATUS_OPTIONS,
  ProjectOutreachBadge,
  type ProjectContributorTracking,
  type ProjectOutreachStatus,
  type ProjectTrackingUpdate,
} from "@/components/project-outreach"
import { getProjectOutreachStatusLabel } from "@/lib/status-styles"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useAuthPermissions } from "@/lib/client-permissions"

type PipelineItem = {
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

type DueFilter = "all" | "due" | "overdue" | "today" | "upcoming" | "none"
type StatusFilter = "all" | ProjectOutreachStatus

const ACTIVE_STATUSES = new Set<ProjectOutreachStatus>(["contacted", "replied", "interested", "interviewing"])
const PIPELINE_PAGE_SIZE = 50

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

function addDays(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatDate(date: string | null) {
  if (!date) return "Not set"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`))
}

function isDue(item: PipelineItem) {
  const date = item.tracking.nextFollowUpAt
  return Boolean(date) && date! <= todayString() && item.tracking.status !== "archived" && item.tracking.status !== "rejected"
}

function dueLabel(date: string | null) {
  if (!date) return "No follow-up"
  const today = todayString()
  if (date === today) return "Due today"
  if (date < today) return "Overdue"
  return "Upcoming"
}

function toPreviewSummary(item: PipelineItem): ContributorPreviewSummary {
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

function matchesDueFilter(item: PipelineItem, filter: DueFilter) {
  const date = item.tracking.nextFollowUpAt
  const today = todayString()
  if (filter === "all") return true
  if (filter === "none") return !date
  if (!date) return false
  if (filter === "due") return date <= today
  if (filter === "overdue") return date < today
  if (filter === "today") return date === today
  return date > today
}

function sortByFollowUp(a: PipelineItem, b: PipelineItem) {
  const aDate = a.tracking.nextFollowUpAt ?? "9999-12-31"
  const bDate = b.tracking.nextFollowUpAt ?? "9999-12-31"
  if (aDate !== bDate) return aDate.localeCompare(bDate)
  return a.contributor.username.localeCompare(b.contributor.username)
}

function isPipelineItem(value: unknown): value is PipelineItem {
  if (!value || typeof value !== "object") return false
  const item = value as Partial<PipelineItem>
  return Boolean(
    item.tracking && typeof item.tracking.id === "string" &&
    item.contributor && typeof item.contributor.id === "string" && typeof item.contributor.username === "string" &&
    item.project && typeof item.project.id === "string" && typeof item.project.name === "string"
  )
}

export function PipelineWorkspace() {
  const { canWrite } = useAuthPermissions()
  const { toast } = useToast()
  const [items, setItems] = useState<PipelineItem[]>([])
  const [projectOptions, setProjectOptions] = useState<Array<{ id: string; name: string }>>([])
  const [totalItems, setTotalItems] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null)
  const [staleFilters, setStaleFilters] = useState(false)
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set())
  const [previewItem, setPreviewItem] = useState<PipelineItem | null>(null)
  const [projectFilter, setProjectFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [dueFilter, setDueFilter] = useState<DueFilter>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const previewPrefetchTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const lastSuccessfulViewRef = useRef<string | null>(null)

  const cancelPreviewPrefetch = useCallback((contributorId: string) => {
    const timeout = previewPrefetchTimers.current.get(contributorId)
    if (!timeout) return
    clearTimeout(timeout)
    previewPrefetchTimers.current.delete(contributorId)
  }, [])

  const schedulePreviewPrefetch = useCallback((item: PipelineItem) => {
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

  const loadPipeline = useCallback(async (append = false, offsetOverride = 0) => {
    if (append) setLoadingMore(true)
    else setLoading(true)
    const query = searchQuery.trim()
    const viewKey = [projectFilter, statusFilter, dueFilter, query].join("|")
    try {
      const params = new URLSearchParams({
        limit: String(PIPELINE_PAGE_SIZE),
        offset: String(append ? offsetOverride : 0),
        project: projectFilter,
        status: statusFilter,
        due: dueFilter,
      })
      if (query) params.set("search", query)
      const response = await fetch(`/api/pipeline?${params.toString()}`, { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data && typeof data.error === "string" ? data.error : "Pipeline could not load")
      }
      if (
        !data ||
        !Array.isArray(data.items) ||
        !data.items.every(isPipelineItem) ||
        !Array.isArray(data.projects) ||
        data.projects.some((project: unknown) => {
          if (!project || typeof project !== "object") return true
          const option = project as { id?: unknown; name?: unknown }
          return typeof option.id !== "string" || typeof option.name !== "string"
        }) ||
        typeof data.total !== "number" ||
        typeof data.hasMore !== "boolean"
      ) {
        throw new Error("Pipeline returned an invalid response")
      }
      const nextItems = data.items
      setItems((prev) => (append ? [...prev, ...nextItems] : nextItems))
      setProjectOptions(data.projects)
      setTotalItems(data.total)
      setHasMore(data.hasMore)
      setLoadError(null)
      setLastLoadedAt(new Date())
      setStaleFilters(false)
      lastSuccessfulViewRef.current = viewKey
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Pipeline could not load")
      setStaleFilters(lastSuccessfulViewRef.current !== viewKey)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [dueFilter, projectFilter, searchQuery, statusFilter])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadPipeline(false)
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [loadPipeline])

  const followUpsDue = useMemo(() => items.filter(isDue).sort(sortByFollowUp), [items])
  const activeItems = useMemo(
    () =>
      items
        .filter((item) => ACTIVE_STATUSES.has(item.tracking.status) && !isDue(item))
        .sort(sortByFollowUp),
    [items]
  )
  const archivedFilteredItems = useMemo(
    () =>
      statusFilter === "archived" || statusFilter === "rejected"
        ? items.filter((item) => item.tracking.status === statusFilter).sort(sortByFollowUp)
        : [],
    [items, statusFilter]
  )

  const dueCount = items.filter(isDue).length
  const activeCount = items.filter((item) => ACTIVE_STATUSES.has(item.tracking.status)).length

  function itemMatchesCurrentView(item: PipelineItem) {
    if (projectFilter !== "all" && item.project.id !== projectFilter) return false
    if (statusFilter !== "all" && item.tracking.status !== statusFilter) return false
    if (statusFilter === "all" && dueFilter === "all") {
      if (item.tracking.status === "archived" || item.tracking.status === "rejected") return false
      if (!isDue(item) && !ACTIVE_STATUSES.has(item.tracking.status)) return false
    }
    if (!matchesDueFilter(item, dueFilter)) return false
    const query = searchQuery.trim().toLowerCase()
    if (!query) return true
    return (
      item.contributor.username.toLowerCase().includes(query) ||
      item.contributor.name.toLowerCase().includes(query)
    )
  }

  async function updateTracking(item: PipelineItem, updates: ProjectTrackingUpdate) {
    if (!canWrite) return null
    setSavingIds((prev) => new Set(prev).add(item.tracking.id))
    try {
      const response = await fetch(`/api/ecosystems/${item.project.id}/tracking`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contributorId: item.contributor.id, ...updates }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Pipeline item could not be updated")
      const tracking = data.tracking as ProjectContributorTracking
      const nextItem = { ...item, tracking }
      const remainsVisible = itemMatchesCurrentView(nextItem)
      setItems((prev) =>
        remainsVisible
          ? prev.map((current) => (current.tracking.id === item.tracking.id ? nextItem : current))
          : prev.filter((current) => current.tracking.id !== item.tracking.id)
      )
      if (!remainsVisible) setTotalItems((current) => Math.max(0, current - 1))
      setPreviewItem((current) => (current?.tracking.id === item.tracking.id ? nextItem : current))
      return tracking
    } catch (err) {
      const message = err instanceof Error ? err.message : "Pipeline item could not be updated"
      toast({ title: "Could not update pipeline", description: message, variant: "destructive" })
      return null
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev)
        next.delete(item.tracking.id)
        return next
      })
    }
  }

  async function markFollowedUp(item: PipelineItem) {
    const tracking = await updateTracking(item, {
      lastContactedAt: todayString(),
      nextFollowUpAt: null,
    })
    if (tracking) toast({ title: "Follow-up cleared", description: `${item.contributor.name} was marked followed up.` })
  }

  async function snooze(item: PipelineItem, days: number) {
    const tracking = await updateTracking(item, { nextFollowUpAt: addDays(days) })
    if (tracking) toast({ title: "Follow-up snoozed", description: `${item.contributor.name} is due ${formatDate(tracking.nextFollowUpAt)}.` })
  }

  async function archive(item: PipelineItem) {
    const tracking = await updateTracking(item, { status: "archived" })
    if (tracking) toast({ title: "Contributor archived", description: `${item.contributor.name} was archived for this Project.` })
  }

  function resetFilters() {
    setProjectFilter("all")
    setStatusFilter("all")
    setDueFilter("all")
    setSearchQuery("")
  }

  return (
    <>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="border-border bg-card shadow-none ">
            <CardContent className="p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Due</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{dueCount}</p>
              <p className="mt-1 text-sm font-medium text-muted-foreground">Follow-ups due today or overdue</p>
            </CardContent>
          </Card>
          <Card className="border-border bg-card shadow-none ">
            <CardContent className="p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Active</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{activeCount}</p>
              <p className="mt-1 text-sm font-medium text-muted-foreground">Contacted through interviewing</p>
            </CardContent>
          </Card>
          <Card className="border-border bg-card shadow-none ">
            <CardContent className="p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tracked</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{totalItems}</p>
              <p className="mt-1 text-sm font-medium text-muted-foreground">Matching pipeline records</p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border bg-card shadow-none ">
          <CardContent className="p-3">
            <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto] lg:items-end">
              <div className="space-y-2">
                <Label htmlFor="pipeline-search">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="pipeline-search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search username or name..."
                    className="bg-card pl-10"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Project</Label>
                <Select value={projectFilter} onValueChange={setProjectFilter}>
                  <SelectTrigger className="bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Projects</SelectItem>
                    {projectOptions.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                  <SelectTrigger className="bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {PROJECT_OUTREACH_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Due date</Label>
                <Select value={dueFilter} onValueChange={(value) => setDueFilter(value as DueFilter)}>
                  <SelectTrigger className="bg-card">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Active + due</SelectItem>
                    <SelectItem value="due">Due or overdue</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="today">Due today</SelectItem>
                    <SelectItem value="upcoming">Upcoming</SelectItem>
                    <SelectItem value="none">No follow-up</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" onClick={resetFilters} className="bg-card">
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>

        {loadError && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-destructive">Pipeline could not refresh</p>
              <p className="break-words text-xs text-muted-foreground">{loadError}</p>
              {lastLoadedAt && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {staleFilters
                    ? "Showing the last successful view; the current filters were not applied."
                    : `Showing the last update from ${lastLoadedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`}
                </p>
              )}
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => loadPipeline(false)}>
              Retry
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-4 py-6 text-sm font-semibold text-primary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading pipeline...
          </div>
        ) : items.length === 0 && !loadError ? (
          <div className="rounded-lg border border-border bg-card px-5 py-10 text-center shadow-none">
            <CalendarClock className="mx-auto h-10 w-10 text-primary" />
            <h2 className="mt-4 text-xl font-semibold text-foreground">No active pipeline items yet.</h2>
            <p className="mx-auto mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
              Add contributors to Projects and set outreach statuses to start tracking follow-ups.
            </p>
          </div>
        ) : (
          <>
            <PipelineSection
              title="Follow-Ups Due"
              description="Contributors with a follow-up date today or earlier."
              items={followUpsDue}
              canWrite={canWrite}
              savingIds={savingIds}
              empty="No follow-ups due in the current filters."
              onOpenPreview={setPreviewItem}
              onPrefetchPreview={schedulePreviewPrefetch}
              onCancelPreviewPrefetch={cancelPreviewPrefetch}
              onUpdateTracking={updateTracking}
              onMarkFollowedUp={markFollowedUp}
              onSnooze={snooze}
              onArchive={archive}
            />
            <PipelineSection
              title="Active Pipeline"
              description="Contacted, replied, interested, and interviewing contributors."
              items={activeItems}
              canWrite={canWrite}
              savingIds={savingIds}
              empty="No active contributors match the current filters."
              onOpenPreview={setPreviewItem}
              onPrefetchPreview={schedulePreviewPrefetch}
              onCancelPreviewPrefetch={cancelPreviewPrefetch}
              onUpdateTracking={updateTracking}
              onMarkFollowedUp={markFollowedUp}
              onSnooze={snooze}
              onArchive={archive}
            />
            {archivedFilteredItems.length > 0 && (
              <PipelineSection
                title={statusFilter === "archived" ? "Archived" : "Rejected"}
                description={`${getProjectOutreachStatusLabel(statusFilter as ProjectOutreachStatus)} contributors matching your filters.`}
                items={archivedFilteredItems}
                canWrite={canWrite}
                savingIds={savingIds}
                empty="No contributors match the current filters."
                onOpenPreview={setPreviewItem}
                onPrefetchPreview={schedulePreviewPrefetch}
                onCancelPreviewPrefetch={cancelPreviewPrefetch}
                onUpdateTracking={updateTracking}
                onMarkFollowedUp={markFollowedUp}
                onSnooze={snooze}
                onArchive={archive}
              />
            )}
            {hasMore && (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => loadPipeline(true, items.length)}
                  disabled={loadingMore}
                  className="bg-card"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    `Load more (${items.length} of ${totalItems})`
                  )}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

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

function PipelineSection({
  title,
  description,
  items,
  canWrite,
  savingIds,
  empty,
  onOpenPreview,
  onPrefetchPreview,
  onCancelPreviewPrefetch,
  onUpdateTracking,
  onMarkFollowedUp,
  onSnooze,
  onArchive,
}: {
  title: string
  description: string
  items: PipelineItem[]
  canWrite: boolean
  savingIds: Set<string>
  empty: string
  onOpenPreview: (item: PipelineItem) => void
  onPrefetchPreview: (item: PipelineItem) => void
  onCancelPreviewPrefetch: (contributorId: string) => void
  onUpdateTracking: (item: PipelineItem, updates: ProjectTrackingUpdate) => Promise<ProjectContributorTracking | null>
  onMarkFollowedUp: (item: PipelineItem) => Promise<void>
  onSnooze: (item: PipelineItem, days: number) => Promise<void>
  onArchive: (item: PipelineItem) => Promise<void>
}) {
  return (
    <Card className="border-border bg-card shadow-none ">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-2xl font-semibold">{title}</CardTitle>
            <p className="mt-1 text-sm font-medium text-muted-foreground">{description}</p>
          </div>
          <Badge variant="secondary" className="w-fit">
            {items.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm font-semibold text-muted-foreground">
            {empty}
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <PipelineRow
                key={item.tracking.id}
                item={item}
                saving={savingIds.has(item.tracking.id)}
                canWrite={canWrite}
                onOpenPreview={onOpenPreview}
                onPrefetchPreview={onPrefetchPreview}
                onCancelPreviewPrefetch={onCancelPreviewPrefetch}
                onUpdateTracking={onUpdateTracking}
                onMarkFollowedUp={onMarkFollowedUp}
                onSnooze={onSnooze}
                onArchive={onArchive}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PipelineRow({
  item,
  saving,
  canWrite,
  onOpenPreview,
  onPrefetchPreview,
  onCancelPreviewPrefetch,
  onUpdateTracking,
  onMarkFollowedUp,
  onSnooze,
  onArchive,
}: {
  item: PipelineItem
  saving: boolean
  canWrite: boolean
  onOpenPreview: (item: PipelineItem) => void
  onPrefetchPreview: (item: PipelineItem) => void
  onCancelPreviewPrefetch: (contributorId: string) => void
  onUpdateTracking: (item: PipelineItem, updates: ProjectTrackingUpdate) => Promise<ProjectContributorTracking | null>
  onMarkFollowedUp: (item: PipelineItem) => Promise<void>
  onSnooze: (item: PipelineItem, days: number) => Promise<void>
  onArchive: (item: PipelineItem) => Promise<void>
}) {
  const githubUrl = item.contributor.contacts.github || `https://github.com/${item.contributor.username}`

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenPreview(item)}
      onMouseEnter={() => onPrefetchPreview(item)}
      onMouseLeave={() => onCancelPreviewPrefetch(item.contributor.id)}
      onFocus={() => onPrefetchPreview(item)}
      onBlur={() => onCancelPreviewPrefetch(item.contributor.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpenPreview(item)
        }
      }}
      className="cursor-pointer rounded-lg border border-border bg-card p-3 shadow-none transition hover:-translate-y-0.5 hover:border-primary/20 hover:bg-muted/30"
    >
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <img
            src={item.contributor.avatar || "/placeholder.svg?height=48&width=48"}
            alt={item.contributor.name}
            className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-border"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{item.contributor.name}</p>
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
              <a
                href={githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                GitHub
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {item.tracking.notes && (
              <p className="mt-2 line-clamp-2 text-xs font-medium leading-relaxed text-muted-foreground">
                {item.tracking.notes}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-2 text-xs font-semibold text-muted-foreground sm:grid-cols-2 xl:grid-cols-1">
          <div>
            <span className="text-foreground">Last contacted:</span> {formatDate(item.tracking.lastContactedAt)}
          </div>
          <div>
            <span className="text-foreground">Next follow-up:</span> {formatDate(item.tracking.nextFollowUpAt)}
            {item.tracking.nextFollowUpAt && (
              <Badge variant="outline" className="ml-2 bg-card">
                {dueLabel(item.tracking.nextFollowUpAt)}
              </Badge>
            )}
          </div>
        </div>

        {canWrite ? (
          <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
            <Label className="text-xs">Status</Label>
            <Select
              value={item.tracking.status}
              onValueChange={(value) => onUpdateTracking(item, { status: value as ProjectOutreachStatus })}
              disabled={saving}
            >
              <SelectTrigger className="h-9 bg-card">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_OUTREACH_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <ProjectOutreachBadge status={item.tracking.status} />
        )}

        {canWrite && (
          <div className="flex flex-wrap gap-2 xl:justify-end" onClick={(event) => event.stopPropagation()}>
            <Button type="button" size="sm" onClick={() => onMarkFollowedUp(item)} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Followed Up
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onSnooze(item, 3)} disabled={saving} className="bg-card">
              Snooze 3d
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onSnooze(item, 7)} disabled={saving} className="bg-card">
              Snooze 1w
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onArchive(item)} disabled={saving} className="bg-card">
              <Archive className="h-4 w-4" />
              Archive
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
