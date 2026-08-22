"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Header } from "@/components/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Layers, ChevronRight, Trash2, Users, Clock, AlertCircle } from "lucide-react"
import { useAuthPermissions } from "@/lib/client-permissions"

type EcosystemSummary = {
  id: string
  name: string
  createdAt: string
  scrapeCount: number
  contributorCount: number
  lastActivityAt: string | null
}

/** Matches real project cards: title row, scrape + contributor stats, View button. */
function EcosystemCardSkeleton({ index }: { index: number }) {
  const titleClass = ["w-56", "w-44", "w-52", "w-40"][index % 4]
  const scrapeClass = ["w-24", "w-28", "w-20", "w-32"][index % 4]
  const contribClass = ["w-32", "w-36", "w-28", "w-40"][index % 4]

  return (
    <Card className="border-border bg-card pointer-events-none">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className={`h-5 max-w-[85%] rounded-md ${titleClass}`} />
          <span className="w-4 h-4 shrink-0" aria-hidden />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 mb-4">
          <Skeleton className={`h-4 rounded-md ${scrapeClass}`} />
          <Skeleton className={`h-4 rounded-md ${contribClass}`} />
        </div>
        <Skeleton className="h-9 w-full rounded-md" />
      </CardContent>
    </Card>
  )
}

function formatTimeAgo(date: string | null) {
  if (!date) return "No scrape activity yet"
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(date))
}

export default function EcosystemsPage() {
  const searchParams = useSearchParams()
  const { canWrite } = useAuthPermissions()
  const [ecosystems, setEcosystems] = useState<EcosystemSummary[]>([])
  const [loading, setLoading]       = useState(true)
  const [creating, setCreating]     = useState(false)
  const [newName, setNewName]       = useState("")
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const newNameInputRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/ecosystems", { cache: "no-store" })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || "Projects could not load")
      if (!Array.isArray(data)) throw new Error("Projects response was incomplete")
      setEcosystems(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Projects could not load")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!canWrite || searchParams.get("action") !== "create") return
    setCreating(true)
    window.setTimeout(() => newNameInputRef.current?.focus(), 0)
  }, [canWrite, searchParams])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!canWrite) return
    if (!newName.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/ecosystems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const eco = await res.json().catch(() => null)
      if (!res.ok) throw new Error(eco?.error || "Project could not be created")
      if (!eco?.id || !eco?.name) throw new Error("Project response was incomplete")
      setEcosystems((prev) => [eco, ...prev])
      setNewName("")
      setCreating(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Project could not be created")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!canWrite) return
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return
    setDeletingIds((current) => new Set(current).add(id))
    setError(null)
    try {
      const response = await fetch(`/api/ecosystems/${id}`, { method: "DELETE" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Project could not be deleted")
      setEcosystems((prev) => prev.filter((ecosystem) => ecosystem.id !== id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Project could not be deleted")
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  return (
    <div className="prism-app">
      <Header />
      <main className="prism-main-narrow">

        {/* ── Page header ──────────────────────────────────────────────── */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="prism-section-title">Library</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Projects</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
              Group scrapes by role, search, or market map without cluttering the dashboard.
            </p>
          </div>
          {!creating && canWrite && (
            <Button onClick={() => setCreating(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              New Project
            </Button>
          )}
        </div>

        {error && (
          <div className="mb-6 flex flex-col gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2 text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <Button variant="outline" size="sm" className="shrink-0 bg-transparent" onClick={() => void load()}>
              Retry loading
            </Button>
          </div>
        )}

        {/* ── Create form ───────────────────────────────────────────────── */}
        {creating && canWrite && (
          <Card className="mb-6 border-primary/30 bg-card">
            <CardContent className="pt-5">
              <form onSubmit={handleCreate} className="flex gap-3">
                <Input
                  ref={newNameInputRef}
                  autoFocus
                  placeholder="Project name (e.g. Staff Solana Engineer)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit" disabled={saving || !newName.trim()}>
                  {saving ? "Creating…" : "Create"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setCreating(false); setNewName("") }}
                >
                  Cancel
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* ── Loading skeletons (same grid + card shell as loaded state) ─ */}
        {loading && (
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            aria-busy="true"
            aria-label="Loading projects"
          >
            {[0, 1, 2, 3].map((i) => (
              <EcosystemCardSkeleton key={i} index={i} />
            ))}
          </div>
        )}

        {/* ── Empty state ───────────────────────────────────────────────── */}
        {!loading && !error && ecosystems.length === 0 && (
          <div className="text-center py-24">
            <Layers className="w-14 h-14 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-1">No projects yet</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Create a project for a role or search, then add scrapes as you work.
            </p>
            {canWrite && (
              <Button onClick={() => setCreating(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                New Project
              </Button>
            )}
          </div>
        )}

        {/* ── Project cards ─────────────────────────────────────────────── */}
        {!loading && ecosystems.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ecosystems.map((eco) => (
              <Card
                key={eco.id}
                className="border-border bg-card hover:border-primary/50 transition-all duration-200 hover:bg-muted/30 group"
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{eco.name}</CardTitle>
                    {canWrite && (
                      <button
                        onClick={(e) => { e.preventDefault(); handleDelete(eco.id, eco.name) }}
                        disabled={deletingIds.has(eco.id)}
                        className="cursor-pointer opacity-0 transition-opacity text-muted-foreground hover:text-destructive group-hover:opacity-100"
                        title={deletingIds.has(eco.id) ? "Deleting Project" : "Delete Project"}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-4 space-y-2 text-sm text-muted-foreground">
                    <p className="flex items-center gap-2">
                      <Layers className="h-3.5 w-3.5" />
                      {eco.scrapeCount} scrape{eco.scrapeCount !== 1 ? "s" : ""}
                    </p>
                    <p className="flex items-center gap-2">
                      <Users className="h-3.5 w-3.5" />
                      {eco.contributorCount.toLocaleString()} contributor{eco.contributorCount !== 1 ? "s" : ""}
                    </p>
                    <p className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5" />
                      {formatTimeAgo(eco.lastActivityAt)}
                    </p>
                  </div>
                  <Link href={`/ecosystems/${eco.id}`}>
                    <Button variant="outline" size="sm" className="w-full bg-transparent hover:bg-primary/10 gap-1">
                      View
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
