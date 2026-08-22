"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Header } from "@/components/header"
import {
  ContributorQuickPreview,
  prefetchContributorPreview,
  type ContributorPreviewSummary,
} from "@/components/contributor-quick-preview"
import {
  getDefaultProjectTracking,
  PROJECT_OUTREACH_STATUS_OPTIONS,
  ProjectOutreachBadge,
  ProjectOutreachForm,
  type ProjectContributorTracking,
  type ProjectOutreachStatus,
  type ProjectTrackingUpdate,
} from "@/components/project-outreach"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ArrowLeft, Trash2, Plus, X, ExternalLink, Linkedin, Globe, Mail, Search, Download, AlertCircle, Pencil, BookmarkPlus
} from "lucide-react"
import { useAuthMe, useAuthPermissions } from "@/lib/client-permissions"
import { getRecentlyViewedScope, recordRecentlyViewed } from "@/lib/recently-viewed"

// ─── Types ────────────────────────────────────────────────────────────────────

type ScrapeInEco = {
  id: string
  target: string
  type: string
  completedAt: string
  contributorCount: number
}

type EcosystemDetail = {
  id: string
  name: string
  createdAt: string
  scrapes: ScrapeInEco[]
}

type EcosystemContributor = {
  id: string
  username: string
  name: string
  avatar: string
  scrapeCount: number
  scrapeTargets: string[]
  totalContributions: number
  contacts: { email?: string; twitter?: string; linkedin?: string; website?: string }
  listIds?: string[]
  tracking?: ProjectContributorTracking | null
}

type ScrapeSummary = { id: string; target: string; type: string }
type ContactFilter = "email" | "linkedin" | "twitter"
type StatusFilter = "all" | ProjectOutreachStatus
type ProjectListSummary = {
  id: string
  projectId: string
  name: string
  contributorCount: number
  contributorIds: string[]
  createdAt: string
  updatedAt: string
}

// ─── X icon ───────────────────────────────────────────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? "")
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.style.visibility = "hidden"
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const CONTRIBUTOR_SKELETON_ROWS = 9
const CONTRIBUTOR_PAGE_SIZE = 50

/** Same table grid as loaded contributor rows: rank, avatar + name + link, repos pill, tag row, contributions, contact icons. */
function ContributorTableSkeleton() {
  const nameWidths = ["w-36", "w-28", "w-40", "w-32", "w-44", "w-32", "w-36", "w-34", "w-36"] as const
  const userWidths = ["w-24", "w-20", "w-28", "w-24", "w-28", "w-24", "w-20", "w-28", "w-24"] as const

  return (
    <div
      className="rounded-lg border border-border overflow-hidden"
      aria-busy="true"
      aria-label="Loading contributors"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-10">#</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Contributor</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Repos</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">
              Appears In
            </th>
            <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">
              Contributions
            </th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Outreach</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Contact</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: CONTRIBUTOR_SKELETON_ROWS }, (_, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              <td className="px-3 py-3 align-middle">
                <Skeleton className="h-4 w-5 ml-auto rounded-md" />
              </td>
              <td className="px-3 py-3 align-middle">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full ring-1 ring-border" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className={`h-4 max-w-full rounded-md ${nameWidths[i % 9]}`} />
                    <Skeleton className={`h-3 max-w-full rounded-md ${userWidths[i % 9]}`} />
                  </div>
                  <Skeleton className="h-3.5 w-3.5 shrink-0 rounded-sm" />
                </div>
              </td>
              <td className="px-3 py-3 align-middle">
                <Skeleton className="h-6 w-[4.5rem] rounded-full" />
              </td>
              <td className="px-3 py-3 align-middle hidden md:table-cell">
                <div className="flex flex-wrap gap-1">
                  <Skeleton className="h-5 w-16 rounded border border-border/60" />
                  <Skeleton className="h-5 w-20 rounded border border-border/60" />
                  <Skeleton className="h-5 w-14 rounded border border-border/60 hidden lg:inline-block" />
                </div>
              </td>
              <td className="px-3 py-3 align-middle hidden sm:table-cell text-right">
                <Skeleton className="h-4 w-12 rounded-md ml-auto" />
              </td>
              <td className="px-3 py-3 align-middle">
                <Skeleton className="h-7 w-32 rounded-full" />
              </td>
              <td className="px-3 py-3 align-middle">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3.5 w-3.5 rounded-sm" />
                  <Skeleton className="h-3.5 w-3.5 rounded-sm" />
                  <Skeleton className="h-3.5 w-3.5 rounded-sm" />
                  <Skeleton className="h-3.5 w-3.5 rounded-sm" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function EcosystemDetailPage() {
  const me = useAuthMe()
  const { canWrite } = useAuthPermissions()
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const recentScope = getRecentlyViewedScope(me)

  const [ecosystem, setEcosystem] = useState<EcosystemDetail | null>(null)
  const [ecosystemLoading, setEcosystemLoading] = useState(true)
  const [ecosystemError, setEcosystemError] = useState<string | null>(null)
  const [contributors, setContributors] = useState<EcosystemContributor[]>([])
  const [contributorsLoading, setContributorsLoading] = useState(true)
  const [contributorsLoadingMore, setContributorsLoadingMore] = useState(false)
  const [contributorsError, setContributorsError] = useState<string | null>(null)
  const [projectContributorCount, setProjectContributorCount] = useState(0)
  const [contributorsTotal, setContributorsTotal] = useState(0)
  const [multiRepoCount, setMultiRepoCount] = useState(0)
  const [contributorsHasMore, setContributorsHasMore] = useState(false)
  const [previewContributor, setPreviewContributor] = useState<ContributorPreviewSummary | null>(null)
  const [allScrapes, setAllScrapes] = useState<ScrapeSummary[]>([])
  const [availableScrapesError, setAvailableScrapesError] = useState<string | null>(null)
  const [selectedScrape, setSelectedScrape] = useState("")
  const [adding, setAdding] = useState(false)
  const [removingScrapeIds, setRemovingScrapeIds] = useState<Set<string>>(new Set())
  const [deletingEcosystem, setDeletingEcosystem] = useState(false)
  const [scrapeMutationError, setScrapeMutationError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [minRepos, setMinRepos] = useState(1)
  const [contactFilters, setContactFilters] = useState<Set<ContactFilter>>(new Set())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [projectLists, setProjectLists] = useState<ProjectListSummary[]>([])
  const [listsLoading, setListsLoading] = useState(true)
  const [selectedListId, setSelectedListId] = useState("all")
  const [newListName, setNewListName] = useState("")
  const [creatingList, setCreatingList] = useState(false)
  const [renamingListId, setRenamingListId] = useState<string | null>(null)
  const [renameListName, setRenameListName] = useState("")
  const [rowListNames, setRowListNames] = useState<Record<string, string>>({})
  const [savingContributorIds, setSavingContributorIds] = useState<Set<string>>(new Set())
  const [listError, setListError] = useState<string | null>(null)
  const [trackingByContributorId, setTrackingByContributorId] = useState<Record<string, ProjectContributorTracking>>({})
  const [trackingLoading] = useState(false)
  const [trackingError, setTrackingError] = useState<string | null>(null)
  const [savingTrackingIds, setSavingTrackingIds] = useState<Set<string>>(new Set())
  const previewPrefetchTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const cancelPreviewPrefetch = useCallback((contributorId: string) => {
    const timeout = previewPrefetchTimers.current.get(contributorId)
    if (!timeout) return
    clearTimeout(timeout)
    previewPrefetchTimers.current.delete(contributorId)
  }, [])

  const schedulePreviewPrefetch = useCallback((contributorId: string) => {
    cancelPreviewPrefetch(contributorId)
    const timeout = setTimeout(() => {
      previewPrefetchTimers.current.delete(contributorId)
      prefetchContributorPreview(contributorId, ecosystem?.id)
    }, 150)
    previewPrefetchTimers.current.set(contributorId, timeout)
  }, [cancelPreviewPrefetch, ecosystem?.id])

  useEffect(() => {
    const timers = previewPrefetchTimers.current
    return () => {
      for (const timeout of timers.values()) clearTimeout(timeout)
      timers.clear()
    }
  }, [])

  const loadProjectShell = useCallback(async () => {
    setEcosystemLoading(true)
    setEcosystemError(null)
    try {
      const [ecoRes, scrapesRes] = await Promise.all([
        fetch(`/api/ecosystems/${id}`, { cache: "no-store" }),
        fetch(`/api/ecosystems/${id}/scrapes`, { cache: "no-store" }),
      ])
      if (ecoRes.status === 404 || scrapesRes.status === 404) {
        router.push("/ecosystems")
        return
      }
      const [ecoBody, scrapesBody] = await Promise.all([
        ecoRes.json().catch(() => null),
        scrapesRes.json().catch(() => null),
      ])
      if (!ecoRes.ok) throw new Error(ecoBody?.error || "Project could not load")
      if (!scrapesRes.ok) throw new Error(scrapesBody?.error || "Project scrapes could not load")
      if (!ecoBody?.ecosystem) throw new Error("Project response was incomplete")
      setEcosystem({
        ...ecoBody.ecosystem,
        scrapes: Array.isArray(scrapesBody?.scrapes)
          ? scrapesBody.scrapes
          : ecoBody.ecosystem.scrapes ?? [],
      })
    } catch (error) {
      setEcosystem(null)
      setEcosystemError(error instanceof Error ? error.message : "Project could not load")
    } finally {
      setEcosystemLoading(false)
    }
  }, [id, router])

  const loadAvailableScrapes = useCallback(async () => {
    if (!canWrite) return
    setAvailableScrapesError(null)
    try {
      const response = await fetch("/api/scrapes/recent?limit=50", { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Available scrapes could not load")
      setAllScrapes(Array.isArray(data?.completed) ? data.completed : [])
    } catch (error) {
      setAllScrapes([])
      setAvailableScrapesError(error instanceof Error ? error.message : "Available scrapes could not load")
    }
  }, [canWrite])

  const loadContributorPage = useCallback(async (append = false, offsetOverride = 0) => {
    if (append) {
      setContributorsLoadingMore(true)
    } else {
      setContributorsLoading(true)
    }
    setContributorsError(null)
    const offset = append ? offsetOverride : 0
    const params = new URLSearchParams({
      limit: String(CONTRIBUTOR_PAGE_SIZE),
      offset: String(offset),
      minRepos: String(minRepos),
      status: statusFilter,
      listId: selectedListId,
    })
    const query = searchQuery.trim()
    if (query) params.set("search", query)
    if (contactFilters.size > 0) params.set("contacts", Array.from(contactFilters).join(","))

    try {
      const response = await fetch(`/api/ecosystems/${id}/contributors?${params.toString()}`, { cache: "no-store" })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error || "Contributor cache request failed")
      const pageContributors = Array.isArray(body?.contributors) ? (body.contributors as EcosystemContributor[]) : []
      setContributors((prev) => (append ? [...prev, ...pageContributors] : pageContributors))
      setContributorsTotal(Number.isFinite(body?.total) ? body.total : pageContributors.length)
      setProjectContributorCount(Number.isFinite(body?.contributorCount) ? body.contributorCount : pageContributors.length)
      setMultiRepoCount(Number.isFinite(body?.multiRepoCount) ? body.multiRepoCount : 0)
      setContributorsHasMore(Boolean(body?.hasMore))
      setTrackingByContributorId((prev) => {
        const next = append ? { ...prev } : {}
        for (const contributor of pageContributors) {
          if (contributor.tracking) next[contributor.id] = contributor.tracking
        }
        return next
      })
    } catch {
      if (!append) {
        setContributors([])
        setProjectContributorCount(0)
        setContributorsTotal(0)
        setMultiRepoCount(0)
      }
      setContributorsError("Contributor cache could not load. Please retry in a moment.")
    } finally {
      setContributorsLoading(false)
      setContributorsLoadingMore(false)
    }
  }, [contactFilters, id, minRepos, searchQuery, selectedListId, statusFilter])

  const loadProjectLists = useCallback(async () => {
    setListsLoading(true)
    setListError(null)
    try {
      const response = await fetch(`/api/ecosystems/${id}/lists`, { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Failed to fetch lists")
      setProjectLists(Array.isArray(data?.lists) ? data.lists : [])
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Failed to fetch lists")
      setProjectLists([])
    } finally {
      setListsLoading(false)
    }
  }, [id])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      await loadProjectShell()
      if (!cancelled) await loadAvailableScrapes()
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [loadAvailableScrapes, loadProjectShell])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadContributorPage(false)
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [loadContributorPage])

  useEffect(() => {
    void loadProjectLists()
  }, [loadProjectLists])

  useEffect(() => {
    if (!ecosystem) return
    recordRecentlyViewed(recentScope, {
      type: "project",
      id: ecosystem.id,
      title: ecosystem.name,
      subtitle: `${ecosystem.scrapes.length} scrape${ecosystem.scrapes.length === 1 ? "" : "s"}`,
      href: `/ecosystems/${ecosystem.id}`,
    })
  }, [ecosystem, recentScope])

  // Scrapes not yet in this project.
  const availableScrapes = allScrapes.filter(
    (s) => !(ecosystem?.scrapes ?? []).some((es) => es.id === s.id)
  )

  async function handleAddScrape() {
    if (!canWrite) return
    if (!selectedScrape) return
    setAdding(true)
    setScrapeMutationError(null)
    try {
      const response = await fetch(`/api/ecosystems/${id}/scrapes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scrapeId: selectedScrape }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Scrape could not be added")
      setSelectedScrape("")
      await Promise.all([loadProjectShell(), loadAvailableScrapes(), loadContributorPage(false)])
    } catch (error) {
      setScrapeMutationError(error instanceof Error ? error.message : "Scrape could not be added")
    } finally {
      setAdding(false)
    }
  }

  async function handleRemoveScrape(scrapeId: string) {
    if (!canWrite) return
    setRemovingScrapeIds((current) => new Set(current).add(scrapeId))
    setScrapeMutationError(null)
    try {
      const response = await fetch(`/api/ecosystems/${id}/scrapes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scrapeId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Scrape could not be removed")
      await Promise.all([loadProjectShell(), loadAvailableScrapes(), loadContributorPage(false)])
    } catch (error) {
      setScrapeMutationError(error instanceof Error ? error.message : "Scrape could not be removed")
    } finally {
      setRemovingScrapeIds((current) => {
        const next = new Set(current)
        next.delete(scrapeId)
        return next
      })
    }
  }

  async function handleDeleteEcosystem() {
    if (!canWrite) return
    if (!confirm(`Delete project "${ecosystem?.name}"? This cannot be undone.`)) return
    setDeletingEcosystem(true)
    setEcosystemError(null)
    try {
      const response = await fetch(`/api/ecosystems/${id}`, { method: "DELETE" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Project could not be deleted")
      router.push("/ecosystems")
    } catch (error) {
      setEcosystemError(error instanceof Error ? error.message : "Project could not be deleted")
    } finally {
      setDeletingEcosystem(false)
    }
  }

  async function createProjectList(name: string, contributorId?: string) {
    const trimmed = name.trim()
    if (!canWrite || !trimmed) return null
    setCreatingList(true)
    setListError(null)
    try {
      const response = await fetch(`/api/ecosystems/${id}/lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Failed to create list")
      const list = data.list as ProjectListSummary
      setProjectLists((prev) => [list, ...prev])
      setSelectedListId(list.id)
      setNewListName("")
      if (contributorId) await saveContributorToList(list.id, contributorId)
      return list
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Failed to create list")
      return null
    } finally {
      setCreatingList(false)
    }
  }

  async function renameProjectList(listId: string) {
    const trimmed = renameListName.trim()
    if (!canWrite || !trimmed) return
    setListError(null)
    const response = await fetch(`/api/ecosystems/${id}/lists/${listId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setListError(data?.error || "Failed to rename list")
      return
    }
    setProjectLists((prev) => prev.map((list) => (list.id === listId ? { ...list, name: data.list.name } : list)))
    setRenamingListId(null)
    setRenameListName("")
  }

  async function deleteProjectList(listId: string, listName: string) {
    if (!canWrite) return
    if (!confirm(`Delete list "${listName}"? Contributors will not be deleted.`)) return
    setListError(null)
    const response = await fetch(`/api/ecosystems/${id}/lists/${listId}`, { method: "DELETE" })
    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setListError(data?.error || "Failed to delete list")
      return
    }
    setProjectLists((prev) => prev.filter((list) => list.id !== listId))
    setSelectedListId((current) => (current === listId ? "all" : current))
  }

  async function saveContributorToList(listId: string, contributorId: string) {
    if (!canWrite) return
    setSavingContributorIds((prev) => new Set(prev).add(contributorId))
    setListError(null)
    try {
      const response = await fetch(`/api/ecosystems/${id}/lists/${listId}/contributors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contributorId }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        if (response.status === 409) return
        throw new Error(data?.error || "Failed to save contributor")
      }
      setProjectLists((prev) =>
        prev.map((list) =>
          list.id === listId
            ? {
                ...list,
                contributorCount: list.contributorCount + 1,
              }
            : list
        )
      )
      setContributors((prev) =>
        prev.map((contributor) =>
          contributor.id === contributorId && !(contributor.listIds ?? []).includes(listId)
            ? { ...contributor, listIds: [...(contributor.listIds ?? []), listId] }
            : contributor
        )
      )
    } catch (error) {
      setListError(error instanceof Error ? error.message : "Failed to save contributor")
    } finally {
      setSavingContributorIds((prev) => {
        const next = new Set(prev)
        next.delete(contributorId)
        return next
      })
    }
  }

  async function createRowListAndSave(contributorId: string) {
    const name = rowListNames[contributorId]?.trim()
    if (!name) return
    await createProjectList(name, contributorId)
    setRowListNames((prev) => ({ ...prev, [contributorId]: "" }))
  }

  function getTracking(contributorId: string) {
    return trackingByContributorId[contributorId] ?? getDefaultProjectTracking(id, contributorId)
  }

  async function updateProjectTracking(contributorId: string, updates: ProjectTrackingUpdate) {
    if (!canWrite) return null
    setSavingTrackingIds((prev) => new Set(prev).add(contributorId))
    setTrackingError(null)
    try {
      const response = await fetch(`/api/ecosystems/${id}/tracking`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contributorId, ...updates }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || "Failed to update outreach tracking")
      }
      const tracking = data.tracking as ProjectContributorTracking
      setTrackingByContributorId((prev) => ({ ...prev, [contributorId]: tracking }))
      return tracking
    } catch (error) {
      setTrackingError(error instanceof Error ? error.message : "Failed to update outreach tracking")
      return null
    } finally {
      setSavingTrackingIds((prev) => {
        const next = new Set(prev)
        next.delete(contributorId)
        return next
      })
    }
  }

  const uniqueContributors = projectContributorCount
  const scrapeRows = ecosystem?.scrapes ?? []
  const maxRepos = Math.max(1, scrapeRows.length)
  const selectedList = projectLists.find((list) => list.id === selectedListId) ?? null

  useEffect(() => {
    setMinRepos((current) => Math.min(maxRepos, Math.max(1, current)))
  }, [maxRepos])

  const filteredContributors = useMemo(() => {
    return contributors
  }, [contributors])

  const toggleContactFilter = useCallback((filter: ContactFilter) => {
    setContactFilters((prev) => {
      const next = new Set(prev)
      if (next.has(filter)) next.delete(filter)
      else next.add(filter)
      return next
    })
  }, [])

  const handleMinReposChange = useCallback((value: string) => {
    const next = Math.floor(Number(value) || 1)
    setMinRepos(Math.min(maxRepos, Math.max(1, next)))
  }, [maxRepos])

  const handleExportCsv = useCallback(() => {
    const headers = [
      "Rank",
      "Name",
      "Username",
      "GitHub Profile",
      "Repo Count",
      "Appears In",
      "Total Contributions",
      "Email",
      "LinkedIn",
      "X",
      "Website",
    ]
    const rows = filteredContributors.map((contributor, index) => [
      index + 1,
      contributor.name,
      contributor.username,
      `https://github.com/${contributor.username}`,
      contributor.scrapeCount,
      contributor.scrapeTargets.join("; "),
      contributor.totalContributions,
      contributor.contacts.email ?? "",
      contributor.contacts.linkedin ?? "",
      contributor.contacts.twitter ?? "",
      contributor.contacts.website ?? "",
    ])
    const name = ecosystem?.name?.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "project"
    downloadCsv(`${name}-contributors.csv`, [headers, ...rows])
  }, [ecosystem?.name, filteredContributors])

  if (!ecosystemLoading && !ecosystem) {
    return (
      <div className="prism-app bg-background">
        <Header />
        <main className="prism-main min-h-screen bg-background">
          <Link
            href="/ecosystems"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Projects
          </Link>
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <h1 className="font-semibold text-foreground">Project could not load</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {ecosystemError || "Talon could not load this Project. Try again in a moment."}
                  </p>
                </div>
              </div>
              <Button variant="outline" className="shrink-0 bg-transparent" onClick={() => void loadProjectShell()}>
                Retry
              </Button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="prism-app bg-background">
      <Header />
      <main className="prism-main min-h-screen bg-background">

        {/* ── Breadcrumb / back ─────────────────────────────────────────── */}
        <Link
          href="/ecosystems"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Projects
        </Link>

        {/* ── Header row ───────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-2">
          {ecosystemLoading ? (
            <Skeleton className="h-9 w-64 max-w-[80%]" />
          ) : ecosystem ? (
            <h1 className="text-3xl font-bold tracking-tight">{ecosystem.name}</h1>
          ) : null}
          {canWrite && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive gap-1.5 shrink-0"
              onClick={handleDeleteEcosystem}
              disabled={ecosystemLoading || !ecosystem || deletingEcosystem}
            >
              <Trash2 className="w-4 h-4" />
              {deletingEcosystem ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>

        {/* ── Stats bar ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 text-sm text-muted-foreground mb-8 flex-wrap">
          <span>
            {ecosystemLoading ? (
              <Skeleton className="h-4 w-24 inline-block align-middle" />
            ) : (
              <>
                <span className="font-mono text-foreground">{scrapeRows.length}</span> scrapes
              </>
            )}
          </span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            {contributorsLoading ? (
              <Skeleton className="h-4 w-28 inline-block align-middle" />
            ) : (
              <>
                <span className="font-mono text-foreground">{uniqueContributors}</span> contributors
              </>
            )}
          </span>
          {!contributorsLoading && multiRepoCount > 0 && (
            <>
              <span>·</span>
              <span className="text-primary font-medium">
                <span className="font-mono">{multiRepoCount}</span> appear in 2+ scrapes
              </span>
            </>
          )}
        </div>

        {/* ── Scrapes panel ────────────────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="text-base font-semibold mb-3 text-muted-foreground uppercase tracking-wide text-xs">
            Scrapes in this Project
          </h2>

          {(scrapeMutationError || ecosystemError) && (
            <div className="mb-3 flex flex-col gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{scrapeMutationError || ecosystemError}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 bg-transparent"
                onClick={() => {
                  setScrapeMutationError(null)
                  setEcosystemError(null)
                  void Promise.all([loadProjectShell(), loadAvailableScrapes(), loadContributorPage(false)])
                }}
              >
                Retry loading
              </Button>
            </div>
          )}

          {/* Scrape chips */}
          <div className="flex flex-wrap gap-2 mb-3">
            {ecosystemLoading && (
              <div className="flex flex-wrap gap-2 w-full">
                <Skeleton className="h-8 w-48 rounded-full" />
                <Skeleton className="h-8 w-40 rounded-full" />
                <Skeleton className="h-8 w-56 rounded-full" />
              </div>
            )}
            {!ecosystemLoading && scrapeRows.length === 0 && (
              <p className="text-sm text-muted-foreground">No scrapes added yet.</p>
            )}
            {!ecosystemLoading &&
              scrapeRows.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full border border-border bg-card text-sm"
              >
                <span className="font-mono text-foreground">{s.target}</span>
                <span className="text-xs text-muted-foreground">· {s.contributorCount}</span>
                {canWrite && (
                  <button
                    onClick={() => handleRemoveScrape(s.id)}
                    disabled={removingScrapeIds.has(s.id)}
                    className="ml-1 cursor-pointer rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title={removingScrapeIds.has(s.id) ? "Removing from project" : "Remove from project"}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              ))}
          </div>

          {/* Add scrape */}
          {canWrite && !ecosystemLoading && availableScrapes.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={selectedScrape} onValueChange={setSelectedScrape}>
                <SelectTrigger className="h-8 w-64 text-sm bg-transparent border-border">
                  <SelectValue placeholder="Add a scrape…" />
                </SelectTrigger>
                <SelectContent>
                  {availableScrapes.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.target}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!selectedScrape || adding}
                onClick={handleAddScrape}
                className="gap-1.5 h-8"
              >
                <Plus className="w-3.5 h-3.5" />
                {adding ? "Adding…" : "Add"}
              </Button>
            </div>
          )}
          {canWrite && !ecosystemLoading && availableScrapesError && (
            <div className="mt-3 flex flex-col gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{availableScrapesError}</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 bg-transparent"
                onClick={() => void loadAvailableScrapes()}
              >
                Retry
              </Button>
            </div>
          )}
        </section>

        {/* ── Project Lists ────────────────────────────────────────────── */}
        <section className="mb-10">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                Lists
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Organize contributors for this specific hiring Project.
              </p>
            </div>
            {canWrite && (
              <div className="flex gap-2">
                <Input
                  value={newListName}
                  onChange={(event) => setNewListName(event.target.value)}
                  placeholder="New list name"
                  maxLength={120}
                  className="h-9 w-56"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => createProjectList(newListName)}
                  disabled={creatingList || !newListName.trim()}
                  className="gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create List
                </Button>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-3 shadow-none ">
            {listError && (
              <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                {listError}
              </div>
            )}
            {listsLoading ? (
              <div className="flex gap-3 overflow-hidden">
                <Skeleton className="h-20 w-44 rounded-lg" />
                <Skeleton className="h-20 w-44 rounded-lg" />
                <Skeleton className="h-20 w-44 rounded-lg" />
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedListId("all")}
                  className={`min-w-44 cursor-pointer rounded-lg border px-4 py-3 text-left transition-all ${
                    selectedListId === "all"
                      ? "border-primary/40 bg-primary/10 text-foreground ring-1 ring-primary/20"
                      : "border-border bg-card text-foreground hover:border-primary/20 hover:bg-muted/40"
                  }`}
                >
                  <p className="text-sm font-semibold">All Contributors</p>
                  <p className="mt-1 text-xs font-semibold text-muted-foreground">{projectContributorCount} total</p>
                </button>

                {projectLists.map((list) => (
                  <div
                    key={list.id}
                    className={`min-w-52 rounded-lg border px-4 py-3 transition-all ${
                      selectedListId === list.id
                        ? "border-primary/40 bg-primary/10 ring-1 ring-primary/20"
                        : "border-border bg-card hover:border-primary/20 hover:bg-muted/40"
                    }`}
                  >
                    {renamingListId === list.id ? (
                      <div className="space-y-2">
                        <Input
                          value={renameListName}
                          onChange={(event) => setRenameListName(event.target.value)}
                          maxLength={120}
                          className="h-8"
                          autoFocus
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7" onClick={() => renameProjectList(list.id)} disabled={!renameListName.trim()}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 bg-card"
                            onClick={() => {
                              setRenamingListId(null)
                              setRenameListName("")
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button type="button" className="w-full cursor-pointer text-left" onClick={() => setSelectedListId(list.id)}>
                          <p className="truncate text-sm font-semibold text-foreground">{list.name}</p>
                          <p className="mt-1 text-xs font-semibold text-muted-foreground">
                            {list.contributorCount} contributor{list.contributorCount === 1 ? "" : "s"}
                          </p>
                        </button>
                        {canWrite && (
                          <div className="mt-3 flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 bg-card text-xs"
                              onClick={() => {
                                setRenamingListId(list.id)
                                setRenameListName(list.name)
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                              Rename
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 bg-card text-xs text-destructive hover:text-destructive"
                              onClick={() => deleteProjectList(list.id, list.name)}
                            >
                              <Trash2 className="h-3 w-3" />
                              Delete
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}

                {projectLists.length === 0 && (
                  <div className="min-w-72 rounded-lg border border-dashed border-primary/20 bg-primary/10 px-4 py-3">
                    <p className="text-sm font-semibold text-foreground">No lists yet</p>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground">
                      Create your first recruiting list for strong fits, outreach, or interview follow-up.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── Contributor intelligence table ───────────────────────────── */}
        <section>
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                Contributor Intelligence
              </h2>
              {!contributorsLoading && projectContributorCount > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Showing {contributors.length} of {contributorsTotal} contributors
                  {selectedList ? ` in ${selectedList.name}` : ""}
                </p>
              )}
            </div>
            {!contributorsLoading && projectContributorCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="gap-2 bg-transparent"
                onClick={handleExportCsv}
                disabled={filteredContributors.length === 0}
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            )}
          </div>

          {contributorsLoading ? (
            <ContributorTableSkeleton />
          ) : contributorsError ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div>
                    <p className="font-semibold text-foreground">Contributor cache could not load</p>
                    <p className="mt-1 text-muted-foreground">
                      Talon could not load the cached contributor intelligence for this Project. If you just
                      applied a migration, retry once the deployment has settled.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 bg-transparent"
                  onClick={() => loadContributorPage(false)}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : projectContributorCount === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm border border-border rounded-lg bg-card">
              {scrapeRows.length === 0
                ? "Add scrapes to see contributor intelligence."
                : "No contactable contributors found for this Project yet."}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end">
                  <div className="space-y-1">
                    <label htmlFor="project-contributor-search" className="text-xs font-medium text-muted-foreground">
                      Search
                    </label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="project-contributor-search"
                        type="search"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder="Search name or username..."
                        className="h-9 pl-8"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="project-min-repos" className="text-xs font-medium text-muted-foreground">
                      Minimum repos
                    </label>
                    <Input
                      id="project-min-repos"
                      type="number"
                      min={1}
                      max={maxRepos}
                      value={minRepos}
                      onChange={(event) => handleMinReposChange(event.target.value)}
                      className="h-9 w-full lg:w-32"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="project-status-filter" className="text-xs font-medium text-muted-foreground">
                      Status
                    </label>
                    <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                      <SelectTrigger id="project-status-filter" className="h-9 w-full bg-transparent lg:w-44">
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
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { key: "email", label: "Has Email" },
                        { key: "linkedin", label: "Has LinkedIn" },
                        { key: "twitter", label: "Has X" },
                      ] as const
                    ).map(({ key, label }) => (
                      <Button
                        key={key}
                        type="button"
                        size="sm"
                        variant={contactFilters.has(key) ? "default" : "outline"}
                        className={contactFilters.has(key) ? "" : "bg-transparent"}
                        onClick={() => toggleContactFilter(key)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              {trackingError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
                  {trackingError}
                </div>
              )}
              {filteredContributors.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground text-sm border border-border rounded-lg bg-card">
                  {selectedList && selectedList.contributorCount === 0
                    ? "No contributors saved to this list yet."
                    : "No contributors match the current filters."}
                </div>
              ) : (
                <>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[1120px] table-fixed text-sm">
                <colgroup>
                  <col className="w-12" />
                  <col className="w-[25%]" />
                  <col className="w-28" />
                  <col className="w-[22%]" />
                  <col className="w-28" />
                  <col className="w-64" />
                  <col className="w-28" />
                  <col className="w-28" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">#</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Contributor</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Repos</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Appears In</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground">Contrib.</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Outreach</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Contact</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContributors.map((c, idx) => {
                    const tracking = getTracking(c.id)
                    const trackingSaving = savingTrackingIds.has(c.id)
                    const visibleTargets = c.scrapeTargets.slice(0, 2)
                    const hiddenTargetCount = Math.max(0, c.scrapeTargets.length - visibleTargets.length)
                    return (
                    <tr
                      key={c.id}
                      tabIndex={0}
                      className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/20 focus-visible:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      onMouseEnter={() => schedulePreviewPrefetch(c.id)}
                      onMouseLeave={() => cancelPreviewPrefetch(c.id)}
                      onFocus={() => schedulePreviewPrefetch(c.id)}
                      onBlur={() => cancelPreviewPrefetch(c.id)}
                      onClick={() =>
                        setPreviewContributor({
                          id: c.id,
                          username: c.username,
                          name: c.name,
                          avatar: c.avatar,
                          contacts: c.contacts,
                          stats: [
                            { label: "Repos", value: c.scrapeCount },
                            { label: "Contributions", value: c.totalContributions.toLocaleString() },
                            { label: "Project", value: ecosystem?.name ?? "Current" },
                          ],
                          repositories: c.scrapeTargets,
                          projects: ecosystem ? [{ id: ecosystem.id, name: ecosystem.name }] : [],
                        })
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return
                        event.preventDefault()
                        setPreviewContributor({
                          id: c.id,
                          username: c.username,
                          name: c.name,
                          avatar: c.avatar,
                          contacts: c.contacts,
                          stats: [
                            { label: "Repos", value: c.scrapeCount },
                            { label: "Contributions", value: c.totalContributions.toLocaleString() },
                            { label: "Project", value: ecosystem?.name ?? "Current" },
                          ],
                          repositories: c.scrapeTargets,
                          projects: ecosystem ? [{ id: ecosystem.id, name: ecosystem.name }] : [],
                        })
                      }}
                    >
                      {/* Rank */}
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {idx + 1}
                      </td>

                      {/* Avatar + name */}
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <Link
                            href={`/contributors/${c.id}`}
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl transition-colors hover:text-primary"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <img
                              src={c.avatar || "/placeholder.svg?height=32&width=32"}
                              alt={c.name}
                              className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">{c.name}</p>
                              <p className="truncate font-mono text-xs text-muted-foreground">@{c.username}</p>
                            </div>
                          </Link>
                          <a
                            href={`https://github.com/${c.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </td>

                      {/* Scrape count badge */}
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
                            c.scrapeCount > 1
                              ? "bg-primary/15 text-primary border border-primary/30"
                              : "bg-muted text-muted-foreground border border-border"
                          }`}
                        >
                          {c.scrapeCount} repo{c.scrapeCount !== 1 ? "s" : ""}
                        </span>
                      </td>

                      {/* Scrape target tags */}
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 flex-wrap gap-1.5" title={c.scrapeTargets.join(", ")}>
                          {visibleTargets.map((t) => (
                            <span
                              key={t}
                              className="inline-flex max-w-[8.5rem] items-center rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground"
                            >
                              <span className="truncate">{t}</span>
                            </span>
                          ))}
                          {hiddenTargetCount > 0 && (
                            <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-bold text-primary">
                              +{hiddenTargetCount} more
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Total contributions */}
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {c.totalContributions.toLocaleString()}
                      </td>

                      {/* Outreach status */}
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
                          {canWrite ? (
                            <Select
                              value={tracking.status}
                              onValueChange={(value) =>
                                updateProjectTracking(c.id, { status: value as ProjectOutreachStatus })
                              }
                              disabled={trackingSaving || trackingLoading}
                            >
                              <SelectTrigger className="h-8 w-40 shrink-0 bg-card text-xs">
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
                          ) : (
                            <ProjectOutreachBadge status={tracking.status} />
                          )}
                          {canWrite && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 shrink-0 bg-transparent text-xs"
                                  disabled={trackingSaving}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  Edit
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="w-96 rounded-lg border-border bg-popover p-3 shadow-none "
                                onClick={(event) => event.stopPropagation()}
                              >
                                <DropdownMenuLabel className="px-0 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                  Project outreach
                                </DropdownMenuLabel>
                                <div className="mt-3">
                                  <ProjectOutreachForm
                                    tracking={tracking}
                                    compact
                                    nativeStatus
                                    saving={trackingSaving}
                                    onSave={async (updates) => {
                                      return updateProjectTracking(c.id, updates)
                                    }}
                                  />
                                </div>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </td>

                      {/* Contact info */}
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          {c.contacts.email?.trim() && (
                            <a
                              href={`mailto:${c.contacts.email}`}
                              title={c.contacts.email}
                              className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Mail className="h-4 w-4" />
                            </a>
                          )}
                          {c.contacts.linkedin?.trim() && (
                            <a
                              href={c.contacts.linkedin}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={c.contacts.linkedin}
                              className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Linkedin className="h-4 w-4" />
                            </a>
                          )}
                          {c.contacts.twitter?.trim() && (
                            <a
                              href={`https://twitter.com/${c.contacts.twitter}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`@${c.contacts.twitter}`}
                              className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <XIcon className="h-4 w-4" />
                            </a>
                          )}
                          {c.contacts.website?.trim() && (
                            <a
                              href={c.contacts.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={c.contacts.website}
                              className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <Globe className="h-4 w-4" />
                            </a>
                          )}
                          {!c.contacts.email && !c.contacts.linkedin && !c.contacts.twitter && !c.contacts.website && (
                            <span className="text-xs text-muted-foreground/40">—</span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center" onClick={(event) => event.stopPropagation()}>
                          {canWrite && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-8 shrink-0 whitespace-nowrap bg-transparent text-xs"
                                  disabled={savingContributorIds.has(c.id)}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <BookmarkPlus className="h-3 w-3" />
                                  Save
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="w-72 rounded-lg border-border bg-popover p-2 shadow-none "
                                onClick={(event) => event.stopPropagation()}
                              >
                                <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                                  Save to list
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                {projectLists.length === 0 ? (
                                  <div className="px-2 py-3 text-sm font-semibold text-muted-foreground">
                                    No lists yet. Create your first recruiting list below.
                                  </div>
                                ) : (
                                  projectLists.map((list) => {
                                    const alreadySaved = c.listIds?.includes(list.id) ?? false
                                    return (
                                      <DropdownMenuItem
                                        key={list.id}
                                        disabled={alreadySaved}
                                        className="cursor-pointer rounded-xl"
                                        onSelect={() => saveContributorToList(list.id, c.id)}
                                      >
                                        <span className="min-w-0 flex-1 truncate">{list.name}</span>
                                        <span className="text-xs text-muted-foreground">
                                          {alreadySaved ? "Saved" : list.contributorCount}
                                        </span>
                                      </DropdownMenuItem>
                                    )
                                  })
                                )}
                                <DropdownMenuSeparator />
                                <div className="space-y-2 p-2">
                                  <Input
                                    value={rowListNames[c.id] ?? ""}
                                    onChange={(event) =>
                                      setRowListNames((prev) => ({ ...prev, [c.id]: event.target.value }))
                                    }
                                    placeholder="New list name"
                                    maxLength={120}
                                    className="h-8"
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="w-full"
                                    disabled={creatingList || !(rowListNames[c.id] ?? "").trim()}
                                    onClick={() => createRowListAndSave(c.id)}
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    Create and Save
                                  </Button>
                                </div>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
              {contributorsHasMore && (
                <div className="flex justify-center pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="bg-transparent"
                    disabled={contributorsLoadingMore}
                    onClick={() => loadContributorPage(true, contributors.length)}
                  >
                    {contributorsLoadingMore ? "Loading..." : "Load more contributors"}
                  </Button>
                </div>
              )}
                </>
              )}
            </div>
          )}
        </section>
      </main>
      <ContributorQuickPreview
        open={Boolean(previewContributor)}
        contributor={previewContributor}
        currentProject={ecosystem ? { id: ecosystem.id, name: ecosystem.name } : null}
        currentProjectTracking={previewContributor ? getTracking(previewContributor.id) : null}
        canSaveToList={canWrite}
        canUpdateProjectTracking={canWrite}
        trackingSaving={previewContributor ? savingTrackingIds.has(previewContributor.id) : false}
        onUpdateProjectTracking={updateProjectTracking}
        onOpenChange={(open) => {
          if (!open) setPreviewContributor(null)
        }}
      />
    </div>
  )
}
