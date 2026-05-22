"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ArrowLeft, Trash2, Plus, X, ExternalLink, Linkedin, Globe, Mail, Search, Download, AlertCircle
} from "lucide-react"
import { useAuthPermissions } from "@/lib/client-permissions"

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
}

type ScrapeSummary = { id: string; target: string; type: string }
type ContactFilter = "email" | "linkedin" | "twitter"

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
  const { canWrite } = useAuthPermissions()
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [ecosystem, setEcosystem] = useState<EcosystemDetail | null>(null)
  const [ecosystemLoading, setEcosystemLoading] = useState(true)
  const [contributors, setContributors] = useState<EcosystemContributor[]>([])
  const [contributorsLoading, setContributorsLoading] = useState(true)
  const [contributorsError, setContributorsError] = useState<string | null>(null)
  const [allScrapes, setAllScrapes] = useState<ScrapeSummary[]>([])
  const [selectedScrape, setSelectedScrape] = useState("")
  const [adding, setAdding] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [minRepos, setMinRepos] = useState(1)
  const [contactFilters, setContactFilters] = useState<Set<ContactFilter>>(new Set())

  const load = useCallback(async () => {
    setContributorsLoading(true)
    setContributorsError(null)
    const [ecoRes, scrapesRes, contribRes] = await Promise.all([
      fetch(`/api/ecosystems/${id}`),
      fetch("/api/scrapes"),
      fetch(`/api/ecosystems/${id}/contributors`),
    ])
    if (ecoRes.status === 404) {
      setEcosystemLoading(false)
      setContributorsLoading(false)
      router.push("/ecosystems")
      return
    }
    const { ecosystem: eco } = await ecoRes.json()
    const { completed } = await scrapesRes.json()
    let contribs: EcosystemContributor[] = []
    if (contribRes.ok) {
      const body = await contribRes.json()
      contribs = body.contributors ?? []
    } else {
      setContributorsError("Contributor cache could not load. Please retry in a moment.")
    }
    setEcosystem(eco)
    setAllScrapes(completed ?? [])
    setContributors(contribs)
    setContributorsLoading(false)
    setEcosystemLoading(false)
  }, [id, router])

  useEffect(() => {
    let cancelled = false
    setEcosystemLoading(true)
    setContributorsLoading(true)

    const run = async () => {
      setContributorsError(null)
      fetch("/api/scrapes")
        .then((r) => r.json())
        .then((j) => {
          if (!cancelled) setAllScrapes(j.completed ?? [])
        })
        .catch(() => {
          if (!cancelled) setAllScrapes([])
        })

      // Metadata first (fast): name + scrape chips are not blocked by contributor aggregation.
      const ecoRes = await fetch(`/api/ecosystems/${id}`)
      if (cancelled) return
      if (ecoRes.status === 404) {
        setEcosystemLoading(false)
        setContributorsLoading(false)
        router.push("/ecosystems")
        return
      }
      const { ecosystem: eco } = await ecoRes.json()
      if (cancelled) return
      setEcosystem(eco)
      setEcosystemLoading(false)

      try {
        const contribRes = await fetch(`/api/ecosystems/${id}/contributors`)
        if (cancelled) return
        if (!contribRes.ok) {
          throw new Error("Contributor cache request failed")
        }
        const body = await contribRes.json()
        setContributors(body.contributors ?? [])
        setContributorsError(null)
      } catch {
        if (!cancelled) {
          setContributors([])
          setContributorsError("Contributor cache could not load. Please retry in a moment.")
        }
      } finally {
        if (!cancelled) setContributorsLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [id, router])

  // Scrapes not yet in this project.
  const availableScrapes = allScrapes.filter(
    (s) => !(ecosystem?.scrapes ?? []).some((es) => es.id === s.id)
  )

  async function handleAddScrape() {
    if (!canWrite) return
    if (!selectedScrape) return
    setAdding(true)
    await fetch(`/api/ecosystems/${id}/scrapes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scrapeId: selectedScrape }),
    })
    setSelectedScrape("")
    setAdding(false)
    await load()
  }

  async function handleRemoveScrape(scrapeId: string) {
    if (!canWrite) return
    await fetch(`/api/ecosystems/${id}/scrapes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scrapeId }),
    })
    await load()
  }

  async function handleDeleteEcosystem() {
    if (!canWrite) return
    if (!confirm(`Delete project "${ecosystem?.name}"? This cannot be undone.`)) return
    await fetch(`/api/ecosystems/${id}`, { method: "DELETE" })
    router.push("/ecosystems")
  }

  const uniqueContributors = contributors.length
  const multiScrapeCount = contributors.filter((c) => c.scrapeCount > 1).length
  const scrapeRows = ecosystem?.scrapes ?? []
  const maxRepos = Math.max(1, scrapeRows.length)

  useEffect(() => {
    setMinRepos((current) => Math.min(maxRepos, Math.max(1, current)))
  }, [maxRepos])

  const filteredContributors = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return contributors
      .filter((contributor) => {
        if (contributor.scrapeCount < minRepos) return false
        if (query && !`${contributor.name} ${contributor.username}`.toLowerCase().includes(query)) return false
        if (contactFilters.has("email") && !contributor.contacts.email?.trim()) return false
        if (contactFilters.has("linkedin") && !contributor.contacts.linkedin?.trim()) return false
        if (contactFilters.has("twitter") && !contributor.contacts.twitter?.trim()) return false
        return true
      })
      .sort((a, b) => b.scrapeCount - a.scrapeCount || b.totalContributions - a.totalContributions)
  }, [contactFilters, contributors, minRepos, searchQuery])

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

  if (!ecosystemLoading && !ecosystem) return null

  return (
    <div className="prism-app">
      <Header />
      <main className="prism-main">

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
              disabled={ecosystemLoading || !ecosystem}
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </Button>
          )}
        </div>

        {/* ── Stats bar ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-8 flex-wrap">
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
          {!contributorsLoading && multiScrapeCount > 0 && (
            <>
              <span>·</span>
              <span className="text-primary font-medium">
                <span className="font-mono">{multiScrapeCount}</span> appear in 2+ scrapes
              </span>
            </>
          )}
        </div>

        {/* ── Scrapes panel ────────────────────────────────────────────── */}
        <section className="mb-10">
          <h2 className="text-base font-semibold mb-3 text-muted-foreground uppercase tracking-wide text-xs">
            Scrapes in this Project
          </h2>

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
                    className="ml-1 cursor-pointer rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    title="Remove from project"
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
        </section>

        {/* ── Contributor intelligence table ───────────────────────────── */}
        <section>
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-base font-semibold text-muted-foreground uppercase tracking-wide text-xs">
                Contributor Intelligence
              </h2>
              {!contributorsLoading && contributors.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Showing {filteredContributors.length} of {contributors.length} contributors
                </p>
              )}
            </div>
            {!contributorsLoading && contributors.length > 0 && (
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
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
                <Button variant="outline" size="sm" className="shrink-0 bg-transparent" onClick={load}>
                  Retry
                </Button>
              </div>
            </div>
          ) : contributors.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm border border-border rounded-lg bg-card">
              {scrapeRows.length === 0
                ? "Add scrapes to see contributor intelligence."
                : "No contactable contributors found for this Project yet."}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
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
              {filteredContributors.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground text-sm border border-border rounded-lg bg-card">
                  No contributors match the current filters.
                </div>
              ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground w-10">#</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Contributor</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Repos</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Appears In</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-muted-foreground hidden sm:table-cell">Contributions</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">Contact</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContributors.map((c, idx) => (
                    <tr
                      key={c.id}
                      className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
                    >
                      {/* Rank */}
                      <td className="px-3 py-3 text-xs font-mono text-muted-foreground text-right">
                        {idx + 1}
                      </td>

                      {/* Avatar + name */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2.5">
                          <img
                            src={c.avatar || "/placeholder.svg?height=32&width=32"}
                            alt={c.name}
                            className="w-8 h-8 rounded-full ring-1 ring-border shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-foreground truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground font-mono truncate">@{c.username}</p>
                          </div>
                          <a
                            href={`https://github.com/${c.username}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </td>

                      {/* Scrape count badge */}
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            c.scrapeCount > 1
                              ? "bg-primary/15 text-primary border border-primary/30"
                              : "bg-muted text-muted-foreground border border-border"
                          }`}
                        >
                          {c.scrapeCount} repo{c.scrapeCount !== 1 ? "s" : ""}
                        </span>
                      </td>

                      {/* Scrape target tags */}
                      <td className="px-3 py-3 hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {c.scrapeTargets.map((t) => (
                            <span
                              key={t}
                              className="px-1.5 py-0.5 rounded text-xs bg-muted text-muted-foreground font-mono border border-border"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Total contributions */}
                      <td className="px-3 py-3 text-right font-mono text-xs text-muted-foreground hidden sm:table-cell">
                        {c.totalContributions.toLocaleString()}
                      </td>

                      {/* Contact info */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          {c.contacts.email?.trim() && (
                            <a
                              href={`mailto:${c.contacts.email}`}
                              title={c.contacts.email}
                              className="text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Mail className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {c.contacts.linkedin?.trim() && (
                            <a
                              href={c.contacts.linkedin}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={c.contacts.linkedin}
                              className="text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Linkedin className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {c.contacts.twitter?.trim() && (
                            <a
                              href={`https://twitter.com/${c.contacts.twitter}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={`@${c.contacts.twitter}`}
                              className="text-muted-foreground hover:text-primary transition-colors"
                            >
                              <XIcon className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {c.contacts.website?.trim() && (
                            <a
                              href={c.contacts.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={c.contacts.website}
                              className="text-muted-foreground hover:text-primary transition-colors"
                            >
                              <Globe className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {!c.contacts.email && !c.contacts.linkedin && !c.contacts.twitter && !c.contacts.website && (
                            <span className="text-xs text-muted-foreground/40">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
