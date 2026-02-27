"use client"

import { useEffect, useState, useMemo, useCallback, useRef } from "react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { EmailCopyButton } from "@/components/email-copy-button"
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
  FileSpreadsheet,
  Inbox,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { motion, AnimatePresence } from "framer-motion"
import { useToast } from "@/hooks/use-toast"
import { Skeleton } from "@/components/ui/skeleton"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

// ─── Types ────────────────────────────────────────────────────────────────────

type Contributor = {
  username: string
  name: string
  avatar: string
  contributions: number
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

function buildCsvContent(contributors: Contributor[], target: string): string {
  const headers = [
    "Name", "Username", "GitHub Profile", "Contributions",
    "Email", "Twitter", "LinkedIn", "Website",
    "Contacted", "Contact Date", "Notes", "Status",
  ]
  const rows = contributors.map((c) => [
    c.name,
    c.username,
    `https://github.com/${c.username}`,
    c.contributions,
    c.contacts?.email?.trim() || "",
    c.contacts?.twitter?.trim() ? `https://twitter.com/${c.contacts.twitter}` : "",
    c.contacts?.linkedin?.trim() || "",
    c.contacts?.website?.trim() || "",
    c.contacted ? "Yes" : "No",
    c.contactedDate || "",
    c.notes || "",
    c.status || "",
  ])
  return [
    headers.join(","),
    ...rows.map((row) =>
      row.map((cell) => {
        const s = String(cell)
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s
      }).join(",")
    ),
  ].join("\n")
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
                  className="h-8 flex-1 rounded-md border border-input bg-background px-3 text-left text-sm text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary transition-all"
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
                    className="h-8 w-8 flex items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary transition-all"
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
  return !!(
    c.contacts?.email?.trim() ||
    c.contacts?.twitter?.trim() ||
    c.contacts?.linkedin?.trim() ||
    c.contacts?.website?.trim()
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RecentScrapes() {
  const [scrapes, setScrapes] = useState<CompletedScrapeSummary[]>([])
  const [expandedScrapes, setExpandedScrapes] = useState<Set<string>>(new Set())
  const [contributorCache, setContributorCache] = useState<Map<string, Contributor[]>>(new Map())
  const [loadingExpansions, setLoadingExpansions] = useState<Set<string>>(new Set())
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()

  // Stable ref so fetchContributors doesn't need contributorCache as a dep
  const cacheRef = useRef(contributorCache)
  useEffect(() => { cacheRef.current = contributorCache }, [contributorCache])

  // ── Fetch the lightweight list ────────────────────────────────────────────
  useEffect(() => {
    const fetchScrapes = async () => {
      try {
        const res = await fetch("/api/scrapes")
        const data = await res.json()
        setScrapes(data.completed || [])
      } catch (err) {
        console.error("[v0] Failed to fetch scrapes:", err)
      } finally {
        setIsLoading(false)
      }
    }
    fetchScrapes()
    const interval = setInterval(fetchScrapes, 30000)
    return () => clearInterval(interval)
  }, [])

  // ── Silent background prefetch (no skeleton, no error toast) ────────────
  const prefetchContributors = useCallback(async (scrapeId: string) => {
    if (cacheRef.current.has(scrapeId)) return
    try {
      const all: Contributor[] = []
      let page = 1
      while (true) {
        const res = await fetch(`/api/scrape/${scrapeId}?page=${page}`)
        if (!res.ok) break
        const data = await res.json()
        all.push(...(data.contributors ?? []))
        if (!data.hasMore) break
        page++
      }
      setContributorCache((prev) => new Map(prev).set(scrapeId, all))
    } catch {
      // Silently ignore — the count will populate if/when the user expands
    }
  }, [])

  // ── Pre-fetch all scrapes as soon as the list loads ───────────────────────
  useEffect(() => {
    if (scrapes.length === 0) return
    for (const scrape of scrapes) {
      prefetchContributors(scrape.id)
    }
  }, [scrapes, prefetchContributors])

  // ── Lazy-load contributors for a single scrape (shown on explicit expand) ─
  const fetchContributors = useCallback(async (scrapeId: string) => {
    if (cacheRef.current.has(scrapeId)) return

    setLoadingExpansions((prev) => new Set(prev).add(scrapeId))
    try {
      const all: Contributor[] = []
      let page = 1
      while (true) {
        const res = await fetch(`/api/scrape/${scrapeId}?page=${page}`)
        if (!res.ok) throw new Error("Failed to load contributors")
        const data = await res.json()
        all.push(...(data.contributors ?? []))
        if (!data.hasMore) break
        page++
      }
      setContributorCache((prev) => new Map(prev).set(scrapeId, all))
    } catch (err) {
      console.error("[v0] Failed to fetch contributors:", err)
      toast({ title: "Error", description: "Failed to load contributors", variant: "destructive" })
    } finally {
      setLoadingExpansions((prev) => {
        const next = new Set(prev)
        next.delete(scrapeId)
        return next
      })
    }
  }, [toast])

  // ── Toggle expand, triggering fetch on first open ─────────────────────────
  const toggleExpanded = useCallback(
    (scrapeId: string) => {
      setExpandedScrapes((prev) => {
        const next = new Set(prev)
        if (next.has(scrapeId)) {
          next.delete(scrapeId)
        } else {
          next.add(scrapeId)
          fetchContributors(scrapeId)
        }
        return next
      })
    },
    [fetchContributors]
  )

  // ── Outreach update writes to Supabase then updates cache ─────────────────
  const updateContributorOutreach = useCallback(
    async (
      _scrapeId: string,
      username: string,
      updates: { contacted?: boolean; contactedDate?: string; notes?: string; status?: string }
    ) => {
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
        if (!res.ok) throw new Error("Failed to update")
      } catch (err) {
        console.error("[v0] Update outreach error:", err)
        toast({ title: "Error", description: "Failed to save outreach update", variant: "destructive" })
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
    [toast]
  )

  // ── Delete ────────────────────────────────────────────────────────────────
  const deleteScrape = useCallback(async (scrapeId: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this scrape? This action cannot be undone.")) return
    try {
      await fetch(`/api/scrape/${scrapeId}`, { method: "DELETE" })
      setScrapes((prev) => prev.filter((s) => s.id !== scrapeId))
      setContributorCache((prev) => { const next = new Map(prev); next.delete(scrapeId); return next })
    } catch (err) {
      console.error("[v0] Failed to delete scrape:", err)
    }
  }, [])

  // ── Export ────────────────────────────────────────────────────────────────
  const exportToCSV = useCallback(
    (scrape: CompletedScrapeSummary, contributors: Contributor[]) => {
      const withContacts = contributors.filter(hasContactInfo)
      const csv = buildCsvContent(withContacts, scrape.target)
      triggerDownload(csv, `${scrape.target.replace(/\//g, "-")}-contributors.csv`, "text/csv")
      toast({ title: "Exported!", description: `Downloaded ${withContacts.length} contributors to CSV`, duration: 3000 })
    },
    [toast]
  )

  const exportToExcel = useCallback(
    (scrape: CompletedScrapeSummary, contributors: Contributor[]) => {
      const withContacts = contributors.filter(hasContactInfo)
      const csv = buildCsvContent(withContacts, scrape.target)
      triggerDownload(csv, `${scrape.target.replace(/\//g, "-")}-contributors.xlsx`, "text/csv")
      toast({ title: "Exported!", description: `Downloaded ${withContacts.length} contributors to Excel`, duration: 3000 })
    },
    [toast]
  )

  // ── Derived ───────────────────────────────────────────────────────────────
  const orgScrapes = useMemo(() => scrapes.filter((s) => s.type === "organization"), [scrapes])
  const repoScrapes = useMemo(() => scrapes.filter((s) => s.type === "repository"), [scrapes])

  // ── Render a single scrape card ───────────────────────────────────────────
  const renderScrapeCard = useCallback(
    (scrape: CompletedScrapeSummary) => {
      const isExpanded = expandedScrapes.has(scrape.id)
      const isLoadingContributors = loadingExpansions.has(scrape.id)
      const contributors = contributorCache.get(scrape.id) ?? null
      const withContacts = contributors ? contributors.filter(hasContactInfo) : null
      const sorted = withContacts ? [...withContacts].sort((a, b) => b.contributions - a.contributions) : []

      return (
        <motion.div
          key={scrape.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          whileHover={{ y: -2 }}
        >
          <Card className="border-border bg-card hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Calendar className="w-3 h-3" />
                    <span>{formatDate(scrape.completedAt)}</span>
                  </div>
                  <CardDescription className="text-xs">{formatTimeAgo(scrape.completedAt)}</CardDescription>
                  <CardTitle className="text-base font-mono mt-2">{scrape.target}</CardTitle>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive transition-colors"
                  onClick={() => deleteScrape(scrape.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
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
                      {withContacts !== null ? withContacts.length : "—"}
                    </motion.span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="bg-transparent hover:bg-primary/10 transition-all duration-300 flex-1"
                    onClick={() => toggleExpanded(scrape.id)}
                  >
                    {isExpanded ? (
                      <><ChevronUp className="w-4 h-4 mr-2" />Hide</>
                    ) : (
                      <><ChevronDown className="w-4 h-4 mr-2" />View All ({scrape.contributorCount})</>
                    )}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        disabled={!contributors}
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
                      <DropdownMenuItem
                        onClick={() => contributors && exportToExcel(scrape, contributors)}
                        className="cursor-pointer"
                      >
                        <FileSpreadsheet className="w-4 h-4 mr-2" />Excel
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Expanded contributor list */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className="space-y-3 mt-4 max-h-[600px] overflow-y-auto pr-2"
                    >
                      {/* Loading skeleton while fetching contributor details */}
                      {isLoadingContributors && (
                        <div className="space-y-3">
                          {[1, 2, 3].map((i) => (
                            <div
                              key={i}
                              className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card"
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
                      {!isLoadingContributors && sorted.map((contributor, index) => (
                        <motion.div
                          key={contributor.username}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.3, delay: index * 0.05 }}
                          className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-card hover:border-primary/30 transition-all duration-300 hover:shadow-md"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <img
                                src={contributor.avatar || "/placeholder.svg?height=40&width=40"}
                                alt={contributor.name}
                                className="w-10 h-10 rounded-full ring-2 ring-border hover:ring-primary transition-all duration-300"
                              />
                              <div>
                                <p className="font-semibold text-foreground">{contributor.name}</p>
                                <p className="text-sm text-muted-foreground font-mono">
                                  @{contributor.username} · {contributor.contributions} contributions
                                </p>
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="bg-transparent hover:bg-primary/10 transition-all duration-300"
                              onClick={() => window.open(`https://github.com/${contributor.username}`)}
                            >
                              <ExternalLink className="w-3 h-3 mr-1" />
                              GitHub
                            </Button>
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
                          <OutreachFields
                            scrapeId={scrape.id}
                            contributor={contributor}
                            onUpdate={updateContributorOutreach}
                          />
                        </motion.div>
                      ))}

                      {/* Empty state: loaded but no contacts */}
                      {!isLoadingContributors && contributors !== null && sorted.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No contributors with contact information found.
                        </p>
                      )}
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
      contributorCache,
      toggleExpanded,
      deleteScrape,
      exportToCSV,
      exportToExcel,
      updateContributorOutreach,
    ]
  )

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
        <h2 className="text-2xl font-semibold tracking-tight">Completed Scrapes</h2>
        <Tabs defaultValue="organizations" className="w-full">
          <TabsList className="bg-muted">
            <TabsTrigger value="organizations">Organizations</TabsTrigger>
            <TabsTrigger value="repositories">Repositories</TabsTrigger>
          </TabsList>

          <TabsContent value="organizations" className="space-y-4 mt-6">
            {orgScrapes.length === 0
              ? <EmptyState type="organization" />
              : <div className="grid grid-cols-1 gap-4">{orgScrapes.map(renderScrapeCard)}</div>
            }
          </TabsContent>

          <TabsContent value="repositories" className="space-y-4 mt-6">
            {repoScrapes.length === 0
              ? <EmptyState type="repository" />
              : <div className="grid grid-cols-1 gap-4">{repoScrapes.map(renderScrapeCard)}</div>
            }
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const XIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)
