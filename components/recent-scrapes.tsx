"use client"

import { useEffect, useState, useMemo, useCallback, useRef, forwardRef, useImperativeHandle } from "react"
import Link from "next/link"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { EmailCopyButton } from "@/components/email-copy-button"
import {
  ContributorQuickPreview,
  prefetchContributorPreview,
  type ContributorPreviewSummary,
} from "@/components/contributor-quick-preview"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Linkedin,
  Globe,
  ExternalLink,
  Calendar,
  ChevronDown,
  ChevronUp,
  Trash2,
  Check,
  Download,
  Inbox,
  Share2,
  Copy,
  CheckCheck,
  Search,
  MapPin,
  AlertTriangle,
  RotateCw,
  FolderPlus,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { motion, AnimatePresence } from "framer-motion"
import { useToast } from "@/hooks/use-toast"
import { Skeleton } from "@/components/ui/skeleton"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuthMe, useAuthPermissions } from "@/lib/client-permissions"
import { getRecentlyViewedScope, recordRecentlyViewed } from "@/lib/recently-viewed"
import { setBoundedMapEntry } from "@/lib/bounded-cache"
import { buildCsvContent, hasExportableContact } from "@/lib/csv-export"
import { contributorMatchesLocation } from "@/lib/contributor-location-search"
import { buildMergedPullRequestsUrl } from "@/lib/github-merged-pr-search"

// ─── Types ────────────────────────────────────────────────────────────────────

type Contributor = {
  id: string
  username: string
  name: string
  avatar: string
  contributions: number
  location?: string | null
  // contacts is optional so missing/null at runtime is handled gracefully
  contacts?: {
    email?: string | null
    twitter?: string | null
    linkedin?: string | null
    website?: string | null
  }
  contacted?: boolean
  contactedDate?: string
  notes?: string
  status?: string | null
}

/** Lightweight summary returned by GET /api/scrapes — no contributor details */
type CompletedScrapeSummary = {
  id: string
  target: string
  type: string
  completedAt: string
  contributorCount: number
  contactInfoCount: number
  projects?: ProjectSummary[]
  error?: string
  job?: {
    id: string
    status: "queued" | "running" | "succeeded" | "failed" | "canceled"
    attempts: number
    maxAttempts: number
    lastError: string | null
  }
}

type ProjectSummary = {
  id: string
  name: string
}

type ShareLinkSummary = {
  id: string
  scrapeId: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  allowDownload: boolean
  lastAccessedAt: string | null
  accessCount: number
}

const RECENT_SCRAPES_PAGE_SIZE = 10
const CONTRIBUTOR_FETCH_PAGE_SIZE = 500
const CONTRIBUTOR_RENDER_BATCH_SIZE = 50
const CONTRIBUTOR_CACHE_LIMIT = 5
const LIST_PREFETCH_DELAY_MS = 250

type CompletedScrapeTab = "repositories" | "organizations"

function tabToScrapeType(tab: CompletedScrapeTab) {
  return tab === "repositories" ? "repository" : "organization"
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date))
}

function formatTimeAgo(date: string | Date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? "s" : ""} ago`
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.style.visibility = "hidden"
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function getPublicApiError(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback
  const response = value as { error?: unknown; message?: unknown }
  if (typeof response.error === "string") return response.error
  if (typeof response.message === "string") return response.message
  return fallback
}

function isShareLinkSummary(value: unknown): value is ShareLinkSummary {
  if (!value || typeof value !== "object") return false
  const share = value as Partial<ShareLinkSummary>
  return (
    typeof share.id === "string" && share.id.length > 0 &&
    typeof share.scrapeId === "string" && share.scrapeId.length > 0 &&
    typeof share.createdAt === "string" &&
    typeof share.expiresAt === "string" &&
    (share.revokedAt === null || typeof share.revokedAt === "string") &&
    typeof share.allowDownload === "boolean" &&
    (share.lastAccessedAt === null || typeof share.lastAccessedAt === "string") &&
    typeof share.accessCount === "number"
  )
}

// ─── OutreachFields ───────────────────────────────────────────────────────────
// Owns local state for notes + date so typing is instant.
// Flushes to the parent (and API) only on blur, not on every keystroke.

interface OutreachFieldsProps {
  scrapeId: string
  contributor: Contributor
  onUpdate: (
    scrapeId: string,
    username: string,
    updates: { contacted?: boolean; contactedDate?: string; notes?: string; status?: string }
  ) => void
}

// Normalize any date string (full ISO or YYYY-MM-DD) down to YYYY-MM-DD.
// The hidden <input type="date"> requires this exact format as its value.
function toDateValue(raw: string | null | undefined): string {
  if (!raw) return ""
  // Take just the date portion before any 'T'
  return raw.split("T")[0]
}

// Format a YYYY-MM-DD value → MM/DD/YYYY for display.
function formatDisplayDate(dateValue: string): string | null {
  if (!dateValue) return null
  const [y, m, d] = dateValue.split("-")
  if (!y || !m || !d) return null
  return `${m}/${d}/${y}`
}

function OutreachFields({ scrapeId, contributor, onUpdate }: OutreachFieldsProps) {
  const [localDate, setLocalDate] = useState(() => toDateValue(contributor.contactedDate))
  const [localNotes, setLocalNotes] = useState(contributor.notes || "")
  const dateInputRef = useRef<HTMLInputElement>(null)

  // Sync if the cache value changes from outside (e.g. another card updated same user)
  useEffect(() => { setLocalDate(toDateValue(contributor.contactedDate)) }, [contributor.contactedDate])
  useEffect(() => { setLocalNotes(contributor.notes || "") }, [contributor.notes])

  function clearDate() {
    setLocalDate("")
    onUpdate(scrapeId, contributor.username, { contactedDate: "" })
  }

  return (
    <div className="pl-14 pt-3 border-t border-border space-y-3">
      <div className="flex items-center gap-3">
        <Switch
          id={`contacted-${contributor.username}`}
          checked={contributor.contacted || false}
          onCheckedChange={(checked) =>
            // Do NOT auto-populate the date — let the user set it manually.
            onUpdate(scrapeId, contributor.username, { contacted: checked })
          }
        />
        <span className="text-sm text-muted-foreground flex items-center gap-2">
          {contributor.contacted && <Check className="w-4 h-4 text-green-500" />}
          {contributor.contacted ? "Contacted" : "Toggle if contacted"}
        </span>
      </div>
      <AnimatePresence>
        {contributor.contacted && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-2"
          >
            <div>
              <Label className="text-xs text-muted-foreground">
                Contact Date
              </Label>
              <div className="relative mt-1 flex items-center gap-1">
                {/* Visible button opens the native calendar picker */}
                <button
                  type="button"
                  onClick={() => dateInputRef.current?.showPicker()}
                  className="h-8 flex-1 cursor-pointer rounded-md border border-input bg-background px-3 text-left text-sm text-foreground transition-all hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {localDate ? (
                    <span>{formatDisplayDate(localDate)}</span>
                  ) : (
                    <span className="text-muted-foreground">Select a date…</span>
                  )}
                </button>
                {/* Clear button — only visible when a date is set */}
                {localDate && (
                  <button
                    type="button"
                    onClick={clearDate}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-all hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    aria-label="Clear date"
                  >
                    ×
                  </button>
                )}
                {/* Hidden native date input — driven by the button above */}
                <input
                  ref={dateInputRef}
                  type="date"
                  value={localDate}
                  onChange={(e) => {
                    setLocalDate(e.target.value)
                    onUpdate(scrapeId, contributor.username, { contactedDate: e.target.value })
                  }}
                  className="absolute inset-0 opacity-0 pointer-events-none"
                  tabIndex={-1}
                />
              </div>
            </div>
            <div>
              <Label htmlFor={`notes-${contributor.username}`} className="text-xs text-muted-foreground">
                Notes (optional)
              </Label>
              <Input
                id={`notes-${contributor.username}`}
                type="text"
                placeholder="e.g., Sent email, LinkedIn message..."
                value={localNotes}
                onChange={(e) => setLocalNotes(e.target.value)}
                onBlur={(e) => {
                  if (e.target.value !== (contributor.notes || "")) {
                    onUpdate(scrapeId, contributor.username, { notes: e.target.value })
                  }
                }}
                className="mt-1 h-8 text-sm bg-background focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Single source of truth for "does this contributor have any contact info?"
 * Uses optional chaining throughout: contacts may be missing or fields may be
 * null/undefined/empty-string depending on what the API returns.
 */
function hasContactInfo(c: Contributor): boolean {
  return hasExportableContact(c)
}

/** Case-insensitive match on name, username, email, LinkedIn URL, or Twitter handle */
function contributorMatchesSearch(c: Contributor, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return true
  const parts = [
    c.name,
    c.username,
    c.contacts?.email,
    c.contacts?.twitter,
    c.contacts?.linkedin,
  ]
  return parts.some((p) => (p ?? "").toLowerCase().includes(q))
}

// ─── Component ────────────────────────────────────────────────────────────────

/** Methods exposed to parent components via ref */
export type RecentScrapesHandle = {
  refresh: () => void
}

export const RecentScrapes = forwardRef<RecentScrapesHandle>(function RecentScrapes(_, ref) {
  const me = useAuthMe()
  const { canWrite } = useAuthPermissions()
  const recentScope = getRecentlyViewedScope(me)
  const [scrapes, setScrapes] = useState<CompletedScrapeSummary[]>([])
  const [failedScrapes, setFailedScrapes] = useState<CompletedScrapeSummary[]>([])
  const [expandedScrapes, setExpandedScrapes] = useState<Set<string>>(new Set())
  const [contributorCache, setContributorCache] = useState<Map<string, Contributor[]>>(new Map())
  const [loadingExpansions, setLoadingExpansions] = useState<Set<string>>(new Set())
  const [contributorErrors, setContributorErrors] = useState<Map<string, { message: string; nextPage: number }>>(new Map())
  const [retryingJobs, setRetryingJobs] = useState<Set<string>>(new Set())
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [assigningScrapeIds, setAssigningScrapeIds] = useState<Set<string>>(new Set())
  const [projectFilter, setProjectFilter] = useState("all")
  const [activeTab, setActiveTab] = useState<CompletedScrapeTab>("repositories")
  const [hasMoreScrapes, setHasMoreScrapes] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [previewContributor, setPreviewContributor] = useState<ContributorPreviewSummary | null>(null)
  const [deleteDialogScrape, setDeleteDialogScrape] = useState<CompletedScrapeSummary | null>(null)
  const [deletingScrapeId, setDeletingScrapeId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [lastListLoadedAt, setLastListLoadedAt] = useState<Date | null>(null)
  const { toast } = useToast()

  // Stable ref so fetchContributors doesn't need contributorCache as a dep
  const cacheRef = useRef(contributorCache)
  const contributorFetchesRef = useRef(new Map<string, Promise<void>>())
  const listPrefetchTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const previewPrefetchTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => { cacheRef.current = contributorCache }, [contributorCache])

  const writeContributorCache = useCallback((scrapeId: string, contributors: Contributor[]) => {
    const next = setBoundedMapEntry(cacheRef.current, scrapeId, contributors, CONTRIBUTOR_CACHE_LIMIT)
    cacheRef.current = next
    setContributorCache(next)
  }, [])

  const cancelPreviewPrefetch = useCallback((contributorId: string) => {
    const timeout = previewPrefetchTimers.current.get(contributorId)
    if (!timeout) return
    clearTimeout(timeout)
    previewPrefetchTimers.current.delete(contributorId)
  }, [])

  const schedulePreviewPrefetch = useCallback((contributorId: string, projectId?: string | null) => {
    cancelPreviewPrefetch(contributorId)
    const timeout = setTimeout(() => {
      previewPrefetchTimers.current.delete(contributorId)
      prefetchContributorPreview(contributorId, projectId)
    }, 150)
    previewPrefetchTimers.current.set(contributorId, timeout)
  }, [cancelPreviewPrefetch])

  useEffect(() => {
    const timers = previewPrefetchTimers.current
    const listTimers = listPrefetchTimers.current
    return () => {
      for (const timeout of timers.values()) clearTimeout(timeout)
      timers.clear()
      for (const timeout of listTimers.values()) clearTimeout(timeout)
      listTimers.clear()
    }
  }, [])

  // ── Fetch the bounded lightweight list ────────────────────────────────────
  const loadScrapes = useCallback(async (offset = 0, append = false) => {
    if (append) {
      setIsLoadingMore(true)
    }

    try {
      const params = new URLSearchParams({
        limit: String(RECENT_SCRAPES_PAGE_SIZE),
        offset: String(offset),
        type: tabToScrapeType(activeTab),
      })
      const res = await fetch(`/api/scrapes/recent?${params.toString()}`, { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(getPublicApiError(data, "Completed scrapes could not load"))
      if (
        !data ||
        !Array.isArray(data.completed) ||
        !Array.isArray(data.failed) ||
        typeof data.hasMore !== "boolean"
      ) {
        throw new Error("Completed scrapes returned an invalid response")
      }
      const completed = data.completed
      setScrapes((prev) => (append ? [...prev, ...completed] : completed))
      if (!append) setFailedScrapes(data.failed)
      setHasMoreScrapes(data.hasMore)
      setListError(null)
      setLastListLoadedAt(new Date())
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Completed scrapes could not load")
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
  }, [activeTab])

  const fetchScrapes = useCallback(() => loadScrapes(0, false), [loadScrapes])

  const loadMoreScrapes = useCallback(() => {
    void loadScrapes(scrapes.length, true)
  }, [loadScrapes, scrapes.length])

  const fetchProjects = useCallback(async () => {
    setProjectsLoading(true)
    try {
      const res = await fetch("/api/ecosystems", { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(getPublicApiError(data, "Projects could not load"))
      if (
        !Array.isArray(data) ||
        data.some((project) => !project || typeof project.id !== "string" || typeof project.name !== "string")
      ) {
        throw new Error("Projects returned an invalid response")
      }
      setProjects(data.map((project: ProjectSummary) => ({ id: project.id, name: project.name })))
      setProjectsError(null)
    } catch (err) {
      setProjectsError(err instanceof Error ? err.message : "Projects could not load")
    } finally {
      setProjectsLoading(false)
    }
  }, [])

  // Expose refresh() so parent components (e.g. page.tsx) can trigger an
  // immediate reload when a scrape completes instead of waiting 30 s.
  useImperativeHandle(ref, () => ({ refresh: fetchScrapes }), [fetchScrapes])

  useEffect(() => {
    fetchScrapes()
    fetchProjects()
    const interval = setInterval(fetchScrapes, 30000)
    return () => clearInterval(interval)
  }, [fetchProjects, fetchScrapes])

  // ── Lazy-load contributors for a single scrape (shown on explicit expand) ─
  const fetchContributors = useCallback((scrapeId: string, startPage = 1) => {
    if (startPage === 1 && cacheRef.current.has(scrapeId)) return
    if (contributorFetchesRef.current.has(scrapeId)) return contributorFetchesRef.current.get(scrapeId)

    setLoadingExpansions((prev) => new Set(prev).add(scrapeId))
    setContributorErrors((prev) => {
      const next = new Map(prev)
      next.delete(scrapeId)
      return next
    })
    const request = (async () => {
      let page = startPage
      try {
        const all: Contributor[] = startPage > 1 ? [...(cacheRef.current.get(scrapeId) ?? [])] : []
        while (true) {
          const params = new URLSearchParams({
            page: String(page),
            pageSize: String(CONTRIBUTOR_FETCH_PAGE_SIZE),
          })
          const res = await fetch(`/api/scrape/${scrapeId}?${params.toString()}`)
          const data = await res.json().catch(() => null)
          if (!res.ok) throw new Error(getPublicApiError(data, "Failed to load contributors"))
          if (!data || !Array.isArray(data.contributors) || typeof data.hasMore !== "boolean") {
            throw new Error("Contributor page returned an invalid response")
          }
          all.push(...data.contributors)
          writeContributorCache(scrapeId, [...all])
          if (!data.hasMore) break
          page++
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load contributors"
        setContributorErrors((prev) => new Map(prev).set(scrapeId, { message, nextPage: page }))
        toast({ title: "Contributor loading paused", description: message, variant: "destructive" })
      } finally {
        contributorFetchesRef.current.delete(scrapeId)
        setLoadingExpansions((prev) => {
          const next = new Set(prev)
          next.delete(scrapeId)
          return next
        })
      }
    })()
    contributorFetchesRef.current.set(scrapeId, request)
    return request
  }, [toast, writeContributorCache])

  const scheduleListPrefetch = useCallback((scrapeId: string) => {
    if (cacheRef.current.has(scrapeId) || contributorFetchesRef.current.has(scrapeId)) return
    const existing = listPrefetchTimers.current.get(scrapeId)
    if (existing) clearTimeout(existing)
    const timeout = setTimeout(() => {
      listPrefetchTimers.current.delete(scrapeId)
      void fetchContributors(scrapeId)
    }, LIST_PREFETCH_DELAY_MS)
    listPrefetchTimers.current.set(scrapeId, timeout)
  }, [fetchContributors])

  const cancelListPrefetch = useCallback((scrapeId: string) => {
    const timeout = listPrefetchTimers.current.get(scrapeId)
    if (!timeout) return
    clearTimeout(timeout)
    listPrefetchTimers.current.delete(scrapeId)
  }, [])

  const retryContributors = useCallback((scrapeId: string) => {
    const failure = contributorErrors.get(scrapeId)
    void fetchContributors(scrapeId, failure?.nextPage ?? 1)
  }, [contributorErrors, fetchContributors])

  // ── Toggle expand, triggering fetch on first open ─────────────────────────
  const toggleExpanded = useCallback(
    (scrape: CompletedScrapeSummary) => {
      const scrapeId = scrape.id
      setExpandedScrapes((prev) => {
        const next = new Set(prev)
        if (next.has(scrapeId)) {
          next.delete(scrapeId)
        } else {
          next.add(scrapeId)
          recordRecentlyViewed(recentScope, {
            type: "scrape",
            id: scrape.id,
            title: scrape.target,
            subtitle: `${scrape.type} scrape`,
            href: "/",
          })
          fetchContributors(scrapeId)
        }
        return next
      })
    },
    [fetchContributors, recentScope]
  )

  // ── Outreach update writes to Supabase then updates cache ─────────────────
  const updateContributorOutreach = useCallback(
    async (
      _scrapeId: string,
      username: string,
      updates: { contacted?: boolean; contactedDate?: string; notes?: string; status?: string }
    ) => {
      if (!canWrite) return
      try {
        const res = await fetch("/api/contributors/outreach", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username,
            contacted: updates.contacted,
            contactedDate: updates.contactedDate,
            notes: updates.notes,
            status: updates.status,
          }),
        })
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error(getPublicApiError(data, "Failed to save outreach update"))
        if (!data || data.success !== true) {
          throw new Error("Talon could not confirm the outreach update")
        }
      } catch (err) {
        toast({
          title: "Outreach update failed",
          description: err instanceof Error ? err.message : "Failed to save outreach update",
          variant: "destructive",
        })
        return
      }
      // Update every cache entry where this username appears
      setContributorCache((prev) => {
        const next = new Map(prev)
        for (const [sid, contribs] of next) {
          next.set(sid, contribs.map((c) => c.username === username ? { ...c, ...updates } : c))
        }
        return next
      })
    },
    [canWrite, toast]
  )

  // ── Delete ────────────────────────────────────────────────────────────────
  const requestDeleteScrape = useCallback((scrape: CompletedScrapeSummary) => {
    if (!canWrite) return
    setDeleteDialogScrape(scrape)
  }, [canWrite])

  const deleteScrape = useCallback(async () => {
    if (!canWrite) return
    const scrapeId = deleteDialogScrape?.id
    if (!scrapeId) return
    setDeletingScrapeId(scrapeId)
    try {
      const response = await fetch(`/api/scrape/${scrapeId}`, { method: "DELETE" })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(getPublicApiError(data, "Failed to delete scrape"))
      }
      if (!data || data.success !== true) {
        throw new Error("Talon could not confirm that the scrape was deleted")
      }
      setScrapes((prev) => prev.filter((s) => s.id !== scrapeId))
      setFailedScrapes((prev) => prev.filter((s) => s.id !== scrapeId))
      setContributorCache((prev) => { const next = new Map(prev); next.delete(scrapeId); return next })
      setDeleteDialogScrape(null)
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Talon could not delete this scrape. Try again.",
        variant: "destructive",
      })
    } finally {
      setDeletingScrapeId(null)
    }
  }, [canWrite, deleteDialogScrape?.id, toast])

  // ── Export ────────────────────────────────────────────────────────────────
  const exportToCSV = useCallback(
    (scrape: CompletedScrapeSummary, contributors: Contributor[]) => {
      const withContacts = contributors.filter(hasContactInfo)
      const csv = buildCsvContent(withContacts)
      triggerDownload(csv, `${scrape.target.replace(/\//g, "-")}-contributors.csv`, "text/csv")
      toast({ title: "Exported!", description: `Downloaded ${withContacts.length} contributors to CSV`, duration: 3000 })
    },
    [toast]
  )

  // ── Derived ───────────────────────────────────────────────────────────────
  const filteredScrapes = useMemo(() => {
    if (projectFilter === "all") return scrapes
    if (projectFilter === "ungrouped") return scrapes.filter((s) => !s.projects?.length)
    return scrapes.filter((s) => s.projects?.some((project) => project.id === projectFilter))
  }, [projectFilter, scrapes])
  const orgScrapes = useMemo(() => filteredScrapes.filter((s) => s.type === "organization"), [filteredScrapes])
  const repoScrapes = useMemo(() => filteredScrapes.filter((s) => s.type === "repository"), [filteredScrapes])

  const addScrapeToProject = useCallback(async (scrape: CompletedScrapeSummary, project: ProjectSummary) => {
    if (!canWrite) return
    setAssigningScrapeIds((prev) => new Set(prev).add(scrape.id))
    try {
      const res = await fetch(`/api/ecosystems/${project.id}/scrapes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scrapeId: scrape.id }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Failed to add scrape to project")
      const addProject = (item: CompletedScrapeSummary) =>
        item.id === scrape.id
          ? { ...item, projects: [...(item.projects ?? []), project] }
          : item
      setScrapes((prev) => prev.map(addProject))
      setFailedScrapes((prev) => prev.map(addProject))
      toast({ title: "Added to project", description: `${scrape.target} is now in ${project.name}.` })
    } catch (error) {
      toast({
        title: "Could not add project",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      })
    } finally {
      setAssigningScrapeIds((prev) => {
        const next = new Set(prev)
        next.delete(scrape.id)
        return next
      })
    }
  }, [canWrite, toast])

  const retryJob = useCallback(async (jobId: string) => {
    if (!canWrite) return
    setRetryingJobs((prev) => new Set(prev).add(jobId))
    try {
      const res = await fetch(`/api/scrape-jobs/${jobId}/retry`, { method: "POST" })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Failed to retry scrape")
      toast({ title: "Retry queued", description: "The scrape will run again shortly." })
      await fetchScrapes()
    } catch (error) {
      toast({
        title: "Retry failed",
        description: error instanceof Error ? error.message : "Unable to retry scrape",
        variant: "destructive",
      })
      await fetchScrapes()
    } finally {
      setRetryingJobs((prev) => {
        const next = new Set(prev)
        next.delete(jobId)
        return next
      })
    }
  }, [canWrite, fetchScrapes, toast])

  // ── Per-card filter / sort state ──────────────────────────────────────────
  type ContactFilter = "email" | "linkedin" | "twitter"
  type SortOrder = "high-low" | "low-high"
  type CardSettings = {
    filters: Set<ContactFilter>
    sort: SortOrder
    contributorSearch: string
    locationSearch: string
  }

  const defaultCardSettings = useCallback(
    (): CardSettings => ({
      filters: new Set<ContactFilter>(),
      sort: "high-low",
      contributorSearch: "",
      locationSearch: "",
    }),
    []
  )

  const [cardSettings, setCardSettings] = useState<Map<string, CardSettings>>(new Map())
  const [visibleContributorCounts, setVisibleContributorCounts] = useState<Map<string, number>>(new Map())

  const showMoreContributors = useCallback((scrapeId: string) => {
    setVisibleContributorCounts((prev) => {
      const next = new Map(prev)
      next.set(scrapeId, (next.get(scrapeId) ?? CONTRIBUTOR_RENDER_BATCH_SIZE) + CONTRIBUTOR_RENDER_BATCH_SIZE)
      return next
    })
  }, [])

  const toggleFilter = useCallback((scrapeId: string, filter: ContactFilter) => {
    setCardSettings((prev) => {
      const next = new Map(prev)
      const cur = next.get(scrapeId) ?? defaultCardSettings()
      const filters = new Set(cur.filters)
      if (filters.has(filter)) filters.delete(filter)
      else filters.add(filter)
      next.set(scrapeId, { ...cur, filters })
      return next
    })
  }, [defaultCardSettings])

  const updateSort = useCallback((scrapeId: string, sort: SortOrder) => {
    setCardSettings((prev) => {
      const next = new Map(prev)
      const cur = next.get(scrapeId) ?? defaultCardSettings()
      next.set(scrapeId, { ...cur, sort })
      return next
    })
  }, [defaultCardSettings])

  const setContributorSearch = useCallback((scrapeId: string, contributorSearch: string) => {
    setCardSettings((prev) => {
      const next = new Map(prev)
      const cur = next.get(scrapeId) ?? defaultCardSettings()
      next.set(scrapeId, { ...cur, contributorSearch })
      return next
    })
  }, [defaultCardSettings])

  const setLocationSearch = useCallback((scrapeId: string, locationSearch: string) => {
    setCardSettings((prev) => {
      const next = new Map(prev)
      const cur = next.get(scrapeId) ?? defaultCardSettings()
      next.set(scrapeId, { ...cur, locationSearch })
      return next
    })
  }, [defaultCardSettings])

  // ── Share modal state ─────────────────────────────────────────────────────
  const [shareModal, setShareModal] = useState<{
    open: boolean
    scrapeId: string
    url: string
    loading: boolean
  }>({
    open: false,
    scrapeId: "",
    url: "",
    loading: false,
  })
  const [shareLinks, setShareLinks] = useState<ShareLinkSummary[]>([])
  const [shareLinksLoading, setShareLinksLoading] = useState(false)
  const [shareLinksError, setShareLinksError] = useState<string | null>(null)
  const [revokingShareIds, setRevokingShareIds] = useState<Set<string>>(new Set())
  const [shareExpiresInDays, setShareExpiresInDays] = useState("7")
  const [shareAllowDownload, setShareAllowDownload] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleShare = useCallback(async (scrapeId: string) => {
    if (!canWrite) return
    setShareModal({ open: true, scrapeId, url: "", loading: false })
    setShareLinks([])
    setShareLinksLoading(true)
    setShareLinksError(null)
    setShareExpiresInDays("7")
    setShareAllowDownload(false)
    try {
      const res = await fetch(`/api/share?scrapeId=${encodeURIComponent(scrapeId)}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(getPublicApiError(data, "Failed to load share links"))
      if (!data || !Array.isArray(data.shares) || !data.shares.every(isShareLinkSummary)) {
        throw new Error("Share history returned an invalid response")
      }
      setShareLinks(data.shares)
      setShareLinksError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load share history"
      setShareLinksError(message)
      toast({ title: "Share history unavailable", description: message, variant: "destructive" })
    } finally {
      setShareLinksLoading(false)
    }
  }, [canWrite, toast])

  const createShareLink = useCallback(async () => {
    if (!shareModal.scrapeId || shareModal.loading) return
    setShareModal((current) => ({ ...current, url: "", loading: true }))
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scrapeId: shareModal.scrapeId,
          expiresInDays: Number(shareExpiresInDays),
          allowDownload: shareAllowDownload,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(getPublicApiError(data, "Failed to create share link"))
      if (!data || typeof data.token !== "string" || data.token.length === 0 || !isShareLinkSummary(data.share)) {
        throw new Error("Talon could not confirm the new share link")
      }
      const { token, share } = data
      const url = `${window.location.origin}/share/${token}`
      setShareModal((current) => ({ ...current, url, loading: false }))
      setShareLinks((current) => [share, ...current])
    } catch (err) {
      setShareModal((current) => ({ ...current, url: "", loading: false }))
      toast({
        title: "Share link creation failed",
        description: err instanceof Error ? err.message : "Failed to create share link",
        variant: "destructive",
      })
    }
  }, [shareAllowDownload, shareExpiresInDays, shareModal.loading, shareModal.scrapeId, toast])

  const revokeShareLink = useCallback(async (shareId: string) => {
    setRevokingShareIds((current) => new Set(current).add(shareId))
    try {
      const res = await fetch("/api/share", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(getPublicApiError(data, "Failed to revoke share link"))
      if (!data || !isShareLinkSummary(data.share) || data.share.id !== shareId || !data.share.revokedAt) {
        throw new Error("Talon could not confirm that the share link was revoked")
      }
      setShareLinks((current) => current.map((share) => (share.id === shareId ? data.share : share)))
      setShareModal((current) => ({ ...current, url: "" }))
      toast({ title: "Share revoked", description: "The public link can no longer be opened." })
    } catch (err) {
      toast({
        title: "Share revocation failed",
        description: err instanceof Error ? err.message : "Failed to revoke share link",
        variant: "destructive",
      })
    } finally {
      setRevokingShareIds((current) => {
        const next = new Set(current)
        next.delete(shareId)
        return next
      })
    }
  }, [toast])

  const copyShareUrl = useCallback(async () => {
    if (!shareModal.url) return
    await navigator.clipboard.writeText(shareModal.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [shareModal.url])

  // ── Render a single scrape card ───────────────────────────────────────────
  const renderScrapeCard = useCallback(
    (scrape: CompletedScrapeSummary) => {
      const isExpanded = expandedScrapes.has(scrape.id)
      const isLoadingContributors = loadingExpansions.has(scrape.id)
      const contributorError = contributorErrors.get(scrape.id)
      const contributors = contributorCache.get(scrape.id) ?? null
      const contactInfoCount = scrape.contactInfoCount
      const assignedProjectIds = new Set((scrape.projects ?? []).map((project) => project.id))
      const availableProjects = projects.filter((project) => !assignedProjectIds.has(project.id))
      const isAssigning = assigningScrapeIds.has(scrape.id)

      const { filters: activeFilters, sort: sortOrder, contributorSearch, locationSearch } =
        cardSettings.get(scrape.id) ?? defaultCardSettings()

      const filteredByToggles = contributors
        ? contributors.filter((c) => {
            if (activeFilters.has("email") && !c.contacts?.email?.trim()) return false
            if (activeFilters.has("linkedin") && !c.contacts?.linkedin?.trim()) return false
            if (activeFilters.has("twitter") && !c.contacts?.twitter?.trim()) return false
            return true
          })
        : []

      const filtered = filteredByToggles.filter(
        (c) =>
          contributorMatchesSearch(c, contributorSearch) &&
          contributorMatchesLocation(c.location, locationSearch)
      )

      const sorted = [...filtered].sort((a, b) =>
        sortOrder === "high-low" ? b.contributions - a.contributions : a.contributions - b.contributions
      )
      const visibleCount = visibleContributorCounts.get(scrape.id) ?? CONTRIBUTOR_RENDER_BATCH_SIZE
      const visibleContributors = sorted.slice(0, visibleCount)

      return (
        <motion.div
          key={scrape.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          whileHover={{ y: -2 }}
        >
          <Card className="border-border bg-card hover:border-primary/50 transition-all duration-300 hover:bg-muted/30">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Calendar className="w-3 h-3" />
                    <span>{formatDate(scrape.completedAt)}</span>
                  </div>
                  <CardDescription className="text-xs">{formatTimeAgo(scrape.completedAt)}</CardDescription>
                  <CardTitle className="text-base font-mono mt-2">{scrape.target}</CardTitle>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {scrape.projects?.length ? (
                      scrape.projects.map((project) => (
                        <span
                          key={project.id}
                          className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
                        >
                          {project.name}
                        </span>
                      ))
                    ) : (
                      <span className="rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                        Ungrouped
                      </span>
                    )}
                  </div>
                </div>
                {canWrite && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => requestDeleteScrape(scrape)}
                    aria-label={`Delete ${scrape.target}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </CardHeader>

            <CardContent>
              <div className="space-y-4">
                {/* Counts */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Contributors</span>
                    <motion.span
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.5, type: "spring" }}
                      className="font-mono text-foreground"
                    >
                      {scrape.contributorCount}
                    </motion.span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">With Contact Info</span>
                    <motion.span
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.5, type: "spring", delay: 0.1 }}
                      className="font-mono text-green-500"
                    >
                      {contactInfoCount}
                    </motion.span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    className="flex-1 shadow-lg shadow-none transition-all duration-300"
                    onClick={() => toggleExpanded(scrape)}
                    onMouseEnter={() => scheduleListPrefetch(scrape.id)}
                    onMouseLeave={() => cancelListPrefetch(scrape.id)}
                    onFocus={() => scheduleListPrefetch(scrape.id)}
                    onBlur={() => cancelListPrefetch(scrape.id)}
                  >
                    {isExpanded ? (
                      <><ChevronUp className="w-4 h-4 mr-2" />Hide Contributors</>
                    ) : (
                      <><ChevronDown className="w-4 h-4 mr-2" />View Contributors ({scrape.contributorCount})</>
                    )}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={!contributors || isLoadingContributors || Boolean(contributorError)}
                        className="bg-transparent hover:bg-primary/10 transition-all duration-300"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                        <ChevronDown className="w-4 h-4 ml-2" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40">
                      <DropdownMenuItem
                        onClick={() => contributors && exportToCSV(scrape, contributors)}
                        className="cursor-pointer"
                      >
                        <Download className="w-4 h-4 mr-2" />CSV
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {canWrite && (
                    <>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="outline"
                            disabled={isAssigning}
                            className="bg-transparent hover:bg-primary/10 transition-all duration-300"
                          >
                            <FolderPlus className="w-4 h-4 mr-2" />
                            Project
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                          {projects.length === 0 ? (
                            <DropdownMenuItem disabled>No projects yet</DropdownMenuItem>
                          ) : availableProjects.length === 0 ? (
                            <DropdownMenuItem disabled>Already in all projects</DropdownMenuItem>
                          ) : (
                            availableProjects.map((project) => (
                              <DropdownMenuItem
                                key={project.id}
                                onClick={() => addScrapeToProject(scrape, project)}
                                className="cursor-pointer"
                              >
                                {project.name}
                              </DropdownMenuItem>
                            ))
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>

                      <Button
                        variant="outline"
                        className="bg-transparent hover:bg-primary/10 transition-all duration-300"
                        onClick={() => handleShare(scrape.id)}
                      >
                        <Share2 className="w-4 h-4 mr-2" />
                        Share
                      </Button>
                    </>
                  )}
                </div>

                {/* Expanded contributor list */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className="mt-4 space-y-3"
                    >
                      {/* Filter / sort controls — visible once loaded */}
                      {contributors !== null && (
                        <div className="flex flex-col gap-2 pb-3 border-b border-border">
                          <div className="grid gap-2 md:grid-cols-2">
                            <div className="relative">
                              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                              <Input
                                type="search"
                                value={contributorSearch}
                                onChange={(e) => setContributorSearch(scrape.id, e.target.value)}
                                placeholder="Search name, @user, email, LinkedIn, X…"
                                aria-label="Filter contributors by name or contact"
                                className="h-8 pl-8 text-xs bg-background border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
                              />
                            </div>
                            <div className="relative">
                              <MapPin className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                              <Input
                                type="search"
                                value={locationSearch}
                                onChange={(e) => setLocationSearch(scrape.id, e.target.value)}
                                placeholder="Location: NYC, New York, London…"
                                aria-label="Filter contributors by self-reported GitHub location"
                                className="h-8 pl-8 text-xs bg-background border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
                              />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Locations are self-reported on GitHub. NYC and New York also match New York City borough names.
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            {(
                              [
                                { key: "email", label: "Email" },
                                { key: "linkedin", label: "LinkedIn" },
                                { key: "twitter", label: "X" },
                              ] as const
                            ).map(({ key, label }) => (
                              <label
                                key={key}
                                className="flex items-center gap-1.5 cursor-pointer select-none group"
                              >
                                <input
                                  type="checkbox"
                                  checked={activeFilters.has(key)}
                                  onChange={() => toggleFilter(scrape.id, key)}
                                  className="h-3.5 w-3.5 rounded border border-border bg-background accent-primary cursor-pointer"
                                />
                                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                                  {label}
                                </span>
                              </label>
                            ))}
                            <div className="flex-1" />
                            <Select
                              value={sortOrder}
                              onValueChange={(v) => updateSort(scrape.id, v as "high-low" | "low-high")}
                            >
                              <SelectTrigger className="h-7 w-52 text-xs bg-transparent border-border">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="high-low">Contributions (High to Low)</SelectItem>
                                <SelectItem value="low-high">Contributions (Low to High)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Showing {visibleContributors.length} of {sorted.length} matching contributors
                            {sorted.length !== (contributors?.length ?? scrape.contributorCount)
                              ? ` (${contributors?.length ?? scrape.contributorCount} total)`
                              : ""}
                          </p>
                        </div>
                      )}

                      {/* Scrollable list */}
                      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                      {/* Loading skeleton while fetching contributor details */}
                      {isLoadingContributors && contributors === null && (
                        <div className="space-y-3">
                          {[1, 2, 3].map((i) => (
                            <div
                              key={i}
                              className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
                            >
                              <Skeleton className="w-10 h-10 rounded-full shrink-0" />
                              <div className="flex-1 space-y-2">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-3 w-48" />
                                <Skeleton className="h-3 w-40" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Contributor rows */}
                      {visibleContributors.map((contributor) => {
                        const mergedPullRequestsUrl = buildMergedPullRequestsUrl({
                          target: scrape.target,
                          type: scrape.type,
                          username: contributor.username,
                        })
                        return (
                        <motion.div
                          key={contributor.username}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.15 }}
                          onMouseEnter={() => schedulePreviewPrefetch(contributor.id, scrape.projects?.[0]?.id)}
                          onMouseLeave={() => cancelPreviewPrefetch(contributor.id)}
                          onFocus={() => schedulePreviewPrefetch(contributor.id, scrape.projects?.[0]?.id)}
                          onBlur={() => cancelPreviewPrefetch(contributor.id)}
                          className="flex flex-col gap-3 p-3 rounded-lg border border-border bg-card hover:border-primary/30 transition-all duration-300 hover:shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <Link
                              href={`/contributors/${contributor.id}`}
                              className="flex min-w-0 items-center gap-3 rounded-lg transition-colors hover:text-primary"
                            >
                              <img
                                src={contributor.avatar || "/placeholder.svg?height=40&width=40"}
                                alt={contributor.name}
                                className="w-10 h-10 rounded-full ring-2 ring-border hover:ring-primary transition-all duration-300"
                              />
                              <div className="min-w-0">
                                <p className="font-semibold text-foreground">{contributor.name}</p>
                                <p className="text-sm text-muted-foreground font-mono">
                                  @{contributor.username} · {contributor.contributions} contributions
                                </p>
                                {contributor.location?.trim() && (
                                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                    <MapPin className="h-3 w-3 shrink-0" />
                                    <span className="truncate">{contributor.location}</span>
                                  </p>
                                )}
                              </div>
                            </Link>
                            <div className="flex shrink-0 flex-wrap justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-transparent hover:bg-primary/10 transition-all duration-300"
                                onClick={() =>
                                  setPreviewContributor({
                                    id: contributor.id,
                                    username: contributor.username,
                                    name: contributor.name,
                                    avatar: contributor.avatar,
                                    contacts: contributor.contacts,
                                    stats: [
                                      { label: "Contributions", value: contributor.contributions.toLocaleString() },
                                      { label: "Repos", value: 1 },
                                    ],
                                    repositories: [scrape.target],
                                    projects: scrape.projects ?? [],
                                  })
                                }
                              >
                                Preview
                              </Button>
                              {canWrite && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="bg-transparent hover:bg-primary/10 transition-all duration-300"
                                  onClick={() =>
                                    setPreviewContributor({
                                      id: contributor.id,
                                      username: contributor.username,
                                      name: contributor.name,
                                      avatar: contributor.avatar,
                                      contacts: contributor.contacts,
                                      stats: [
                                        { label: "Contributions", value: contributor.contributions.toLocaleString() },
                                        { label: "Repos", value: 1 },
                                      ],
                                      repositories: [scrape.target],
                                      projects: scrape.projects ?? [],
                                    })
                                  }
                                >
                                  <FolderPlus className="w-3 h-3 mr-1" />
                                  Save to List
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="outline"
                                className="bg-transparent hover:bg-primary/10 transition-all duration-300"
                                asChild
                              >
                                <a
                                  href={`https://github.com/${contributor.username}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <ExternalLink className="w-3 h-3 mr-1" />
                                  GitHub
                                </a>
                              </Button>
                              {mergedPullRequestsUrl && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="bg-transparent hover:bg-primary/10 transition-all duration-300"
                                  asChild
                                >
                                  <a href={mergedPullRequestsUrl} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="w-3 h-3 mr-1" />
                                    Merged PRs
                                  </a>
                                </Button>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2 pl-14">
                            {contributor.contacts?.email?.trim() && (
                              <EmailCopyButton email={contributor.contacts.email!} />
                            )}
                            {contributor.contacts?.twitter?.trim() && (
                              <motion.div whileHover={{ x: 4 }} className="flex items-center gap-2 text-sm group">
                                <XIcon className="w-4 h-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
                                <a
                                  href={`https://twitter.com/${contributor.contacts.twitter}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline font-mono break-all group-hover:text-primary/80 transition-colors"
                                >
                                  @{contributor.contacts.twitter}
                                </a>
                              </motion.div>
                            )}
                            {contributor.contacts?.linkedin?.trim() && (
                              <motion.div whileHover={{ x: 4 }} className="flex items-center gap-2 text-sm group">
                                <Linkedin className="w-4 h-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
                                <a
                                  href={contributor.contacts.linkedin}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline font-mono break-all group-hover:text-primary/80 transition-colors"
                                >
                                  {contributor.contacts.linkedin.split("/").filter(Boolean).pop()}
                                </a>
                              </motion.div>
                            )}
                            {contributor.contacts?.website?.trim() && (
                              <motion.div whileHover={{ x: 4 }} className="flex items-center gap-2 text-sm group">
                                <Globe className="w-4 h-4 text-muted-foreground flex-shrink-0 group-hover:text-primary transition-colors" />
                                <a
                                  href={contributor.contacts.website!}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary hover:underline font-mono break-all group-hover:text-primary/80 transition-colors"
                                >
                                  {contributor.contacts.website}
                                </a>
                              </motion.div>
                            )}
                          </div>

                          {/* Outreach tracking */}
                          {canWrite && (
                            <OutreachFields
                              scrapeId={scrape.id}
                              contributor={contributor}
                              onUpdate={updateContributorOutreach}
                            />
                          )}
                        </motion.div>
                        )
                      })}
                      {isLoadingContributors && contributors !== null && (
                        <p className="py-2 text-center text-xs text-muted-foreground">Loading more contributors…</p>
                      )}
                      {contributorError && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
                          <p className="font-medium text-destructive">Contributor loading stopped before completion.</p>
                          <p className="mt-1 break-words text-xs text-muted-foreground">{contributorError.message}</p>
                          {contributors !== null && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {contributors.length} contributors remain available. Retry resumes from page {contributorError.nextPage}.
                            </p>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => retryContributors(scrape.id)}
                          >
                            <RotateCw className="mr-2 h-3.5 w-3.5" />
                            Retry loading
                          </Button>
                        </div>
                      )}

                      {!isLoadingContributors && visibleContributors.length < sorted.length && (
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full bg-transparent"
                          onClick={() => showMoreContributors(scrape.id)}
                        >
                          Show {Math.min(CONTRIBUTOR_RENDER_BATCH_SIZE, sorted.length - visibleContributors.length)} more
                        </Button>
                      )}

                      {/* Empty state: loaded but no results */}
                      {!isLoadingContributors && contributors !== null && sorted.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-3">
                          {(contributorSearch.trim() || locationSearch.trim()) && filteredByToggles.length > 0
                            ? "No contributors match your search."
                            : activeFilters.size > 0
                              ? "No contributors match the active filters."
                              : "No contributors found."}
                        </p>
                      )}
                      </div>{/* end scrollable list */}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )
    },
    [
      expandedScrapes,
      loadingExpansions,
      contributorErrors,
      contributorCache,
      cardSettings,
      visibleContributorCounts,
      toggleExpanded,
      scheduleListPrefetch,
      cancelListPrefetch,
      retryContributors,
      toggleFilter,
      updateSort,
      handleShare,
      requestDeleteScrape,
      exportToCSV,
      updateContributorOutreach,
      defaultCardSettings,
      setContributorSearch,
      setLocationSearch,
      projects,
      assigningScrapeIds,
      addScrapeToProject,
      cancelPreviewPrefetch,
      canWrite,
      schedulePreviewPrefetch,
      showMoreContributors,
    ]
  )

  const FailedScrapes = () => {
    if (failedScrapes.length === 0) return null

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          <h2 className="text-2xl font-semibold tracking-tight">Failed Scrapes</h2>
        </div>
        <div className="space-y-3">
          {failedScrapes.map((scrape) => {
            const retrying = Boolean(scrape.job?.id && retryingJobs.has(scrape.job.id))

            return (
              <Card key={scrape.id} className="border-destructive/25 bg-card">
                <CardContent className="pt-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm text-foreground">{scrape.target}</p>
                      <p className="text-xs text-muted-foreground">
                        {scrape.type} · {formatTimeAgo(scrape.completedAt)}
                      </p>
                    </div>
                    {canWrite && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-transparent"
                          disabled={!scrape.job?.id || retrying}
                          onClick={() => scrape.job?.id && retryJob(scrape.job.id)}
                        >
                          <RotateCw className={`w-3 h-3 mr-1 ${retrying ? "animate-spin" : ""}`} />
                          {retrying ? "Retrying..." : "Retry"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => requestDeleteScrape(scrape)}
                        >
                          <Trash2 className="w-3 h-3 mr-1" />
                          Delete
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                    {scrape.job?.lastError || scrape.error || "The scrape failed without a recorded error."}
                  </div>
                  {scrape.job && (
                    <p className="text-xs text-muted-foreground">
                      Attempt {scrape.job.attempts}/{scrape.job.maxAttempts} · {scrape.job.status}
                    </p>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Loading skeleton (initial list load) ──────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-border bg-card">
              <CardHeader>
                <Skeleton className="h-4 w-32 mb-2" />
                <Skeleton className="h-6 w-48" />
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // ── Empty-state placeholder ───────────────────────────────────────────────
  const EmptyState = ({ type }: { type: "organization" | "repository" }) => (
    <Card className="border-border bg-card">
      <CardContent className="pt-6">
        <div className="text-center py-12">
          <Inbox className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No {type} scrapes yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Start by scraping a GitHub {type} to discover contributors
          </p>
          <p className="text-xs text-muted-foreground">
            {type === "organization"
              ? <>Try: <span className="font-mono text-primary">vercel</span>, <span className="font-mono text-primary">facebook</span>, or <span className="font-mono text-primary">microsoft</span></>
              : <>Try: <span className="font-mono text-primary">vercel/next.js</span> or <span className="font-mono text-primary">facebook/react</span></>
            }
          </p>
        </div>
      </CardContent>
    </Card>
  )

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <TooltipProvider>
      <div className="space-y-4">
        <FailedScrapes />
        {listError && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Completed scrapes could not refresh</p>
                <p className="break-words text-xs text-muted-foreground">{listError}</p>
                {lastListLoadedAt && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Showing the last update from {lastListLoadedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.
                  </p>
                )}
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={fetchScrapes}>
              <RotateCw className="mr-1 h-3 w-3" />
              Retry
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">Completed Scrapes</h2>
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-9 w-full bg-transparent sm:w-64">
              <SelectValue placeholder="Filter by project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              <SelectItem value="ungrouped">Ungrouped</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {projectsError && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Project filters could not refresh</p>
                <p className="break-words text-xs text-muted-foreground">{projectsError}</p>
                {projects.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Showing the last successfully loaded Project options.</p>
                )}
              </div>
            </div>
            <Button type="button" size="sm" variant="outline" disabled={projectsLoading} onClick={fetchProjects}>
              <RotateCw className={`mr-1 h-3 w-3 ${projectsLoading ? "animate-spin" : ""}`} />
              Retry
            </Button>
          </div>
        )}
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as CompletedScrapeTab)}
          className="w-full"
        >
          <TabsList className="bg-muted">
            <TabsTrigger value="repositories">Repositories</TabsTrigger>
            <TabsTrigger value="organizations">Organizations</TabsTrigger>
          </TabsList>

          <TabsContent value="repositories" className="space-y-4 mt-6">
            {repoScrapes.length === 0
              ? (listError ? null : <EmptyState type="repository" />)
              : <div className="grid grid-cols-1 gap-3">{repoScrapes.map(renderScrapeCard)}</div>
            }
          </TabsContent>

          <TabsContent value="organizations" className="space-y-4 mt-6">
            {orgScrapes.length === 0
              ? (listError ? null : <EmptyState type="organization" />)
              : <div className="grid grid-cols-1 gap-3">{orgScrapes.map(renderScrapeCard)}</div>
            }
          </TabsContent>
        </Tabs>

        {hasMoreScrapes && (
          <div className="flex justify-center pt-2">
            <Button
              type="button"
              variant="outline"
              className="bg-transparent"
              disabled={isLoadingMore}
              onClick={loadMoreScrapes}
            >
              {isLoadingMore ? "Loading..." : "Load more scrapes"}
            </Button>
          </div>
        )}
      </div>

      <ContributorQuickPreview
        open={Boolean(previewContributor)}
        contributor={previewContributor}
        projectOptions={projects}
        canSaveToList={canWrite}
        onOpenChange={(open) => {
          if (!open) setPreviewContributor(null)
        }}
      />

      {/* ── Delete confirmation modal ──────────────────────────────────── */}
      <Dialog
        open={Boolean(deleteDialogScrape)}
        onOpenChange={(open) => {
          if (!open && !deletingScrapeId) setDeleteDialogScrape(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-md border border-destructive/25 bg-destructive/10 text-destructive">
              <Trash2 className="h-5 w-5" />
            </div>
            <DialogTitle>Delete Scrape</DialogTitle>
            <DialogDescription>
              This will permanently delete the scrape and its contributor data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteDialogScrape && (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Scrape</p>
              <p className="mt-1 truncate font-mono text-sm font-semibold text-foreground">
                {deleteDialogScrape.target}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {deleteDialogScrape.type} · completed {formatTimeAgo(deleteDialogScrape.completedAt)}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteDialogScrape(null)}
              disabled={Boolean(deletingScrapeId)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={deleteScrape}
              disabled={Boolean(deletingScrapeId)}
            >
              {deletingScrapeId ? "Deleting..." : "Delete Scrape"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Share modal ────────────────────────────────────────────────── */}
      <Dialog
        open={shareModal.open}
        onOpenChange={(open) => setShareModal((s) => ({ ...s, open }))}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share this scrape</DialogTitle>
            <DialogDescription>
              Anyone with the link can view public profile and contact fields until it expires or is revoked.
            </DialogDescription>
          </DialogHeader>

          {shareModal.loading ? (
            <div className="flex items-center justify-center py-6">
              <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="ml-3 text-sm text-muted-foreground">Generating link…</span>
            </div>
          ) : (
            <div className="space-y-3">
              {shareModal.url ? (
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={shareModal.url}
                    className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    onFocus={(e) => e.target.select()}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 bg-transparent hover:bg-primary/10 transition-colors"
                    onClick={copyShareUrl}
                  >
                    {copied ? (
                      <><CheckCheck className="w-4 h-4 mr-1.5 text-green-500" />Copied!</>
                    ) : (
                      <><Copy className="w-4 h-4 mr-1.5" />Copy</>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4 rounded-md border border-border p-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="share-expiry">Link expires after</Label>
                    <Select value={shareExpiresInDays} onValueChange={setShareExpiresInDays}>
                      <SelectTrigger id="share-expiry">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 day</SelectItem>
                        <SelectItem value="7">7 days</SelectItem>
                        <SelectItem value="30">30 days</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <Label htmlFor="share-download">Allow CSV download</Label>
                      <p className="text-xs text-muted-foreground">The CSV contains only public profile and contact fields.</p>
                    </div>
                    <Switch id="share-download" checked={shareAllowDownload} onCheckedChange={setShareAllowDownload} />
                  </div>
                  <Button type="button" className="w-full" onClick={createShareLink}>
                    Generate secure link
                  </Button>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Recruiter notes, outreach status, reminders, and internal operations data are never included.
              </p>

              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Share history</p>
                {shareLinksLoading ? (
                  <p className="text-sm text-muted-foreground">Loading share history…</p>
                ) : shareLinksError ? (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                    <p className="break-words text-sm text-destructive">{shareLinksError}</p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => handleShare(shareModal.scrapeId)}
                    >
                      <RotateCw className="mr-1 h-3 w-3" />
                      Retry history
                    </Button>
                  </div>
                ) : shareLinks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No share links have been created for this scrape.</p>
                ) : (
                  shareLinks.map((share) => {
                    const expired = Date.parse(share.expiresAt) <= Date.now()
                    const active = !share.revokedAt && !expired
                    return (
                      <div key={share.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                        <div className="min-w-0 text-xs text-muted-foreground">
                          <p className="font-medium text-foreground">{active ? "Active" : share.revokedAt ? "Revoked" : "Expired"}</p>
                          <p>Expires {formatDate(share.expiresAt)} · {share.accessCount} view{share.accessCount === 1 ? "" : "s"}</p>
                          <p>{share.allowDownload ? "CSV download allowed" : "View only"}</p>
                        </div>
                        {active && (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={revokingShareIds.has(share.id)}
                            onClick={() => revokeShareLink(share.id)}
                          >
                            {revokingShareIds.has(share.id) ? "Revoking…" : "Revoke"}
                          </Button>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
})

// ─── Icons ────────────────────────────────────────────────────────────────────

const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)
