"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Header } from "@/components/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Plus, Layers, ChevronRight, Trash2 } from "lucide-react"

type EcosystemSummary = {
  id: string
  name: string
  createdAt: string
  scrapeCount: number
}

/** Matches real ecosystem cards: title row, scrape + contributor stats, View button — `Skeleton` uses `bg-accent animate-pulse` for dark theme. */
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

export default function EcosystemsPage() {
  const [ecosystems, setEcosystems] = useState<EcosystemSummary[]>([])
  const [loading, setLoading]       = useState(true)
  const [creating, setCreating]     = useState(false)
  const [newName, setNewName]       = useState("")
  const [saving, setSaving]         = useState(false)

  async function load() {
    try {
      const res = await fetch("/api/ecosystems")
      const data = await res.json()
      setEcosystems(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/ecosystems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const eco = await res.json()
      setEcosystems((prev) => [eco, ...prev])
      setNewName("")
      setCreating(false)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete ecosystem "${name}"? This cannot be undone.`)) return
    await fetch(`/api/ecosystems/${id}`, { method: "DELETE" })
    setEcosystems((prev) => prev.filter((e) => e.id !== id))
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 sm:px-6 py-8 max-w-5xl">

        {/* ── Page header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Ecosystems</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Group scrapes together to find contributors active across multiple repos.
            </p>
          </div>
          {!creating && (
            <Button onClick={() => setCreating(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              New Ecosystem
            </Button>
          )}
        </div>

        {/* ── Create form ───────────────────────────────────────────────── */}
        {creating && (
          <Card className="mb-6 border-primary/30 bg-card">
            <CardContent className="pt-5">
              <form onSubmit={handleCreate} className="flex gap-3">
                <Input
                  autoFocus
                  placeholder="Ecosystem name (e.g. Rust OSS)"
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
            aria-label="Loading ecosystems"
          >
            {[0, 1, 2, 3].map((i) => (
              <EcosystemCardSkeleton key={i} index={i} />
            ))}
          </div>
        )}

        {/* ── Empty state ───────────────────────────────────────────────── */}
        {!loading && ecosystems.length === 0 && (
          <div className="text-center py-24">
            <Layers className="w-14 h-14 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-1">No ecosystems yet</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Create an ecosystem to group scrapes and surface cross-repo contributors.
            </p>
            <Button onClick={() => setCreating(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              New Ecosystem
            </Button>
          </div>
        )}

        {/* ── Ecosystem cards ───────────────────────────────────────────── */}
        {!loading && ecosystems.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ecosystems.map((eco) => (
              <Card
                key={eco.id}
                className="border-border bg-card hover:border-primary/50 transition-all duration-200 hover:shadow-lg hover:shadow-primary/10 group"
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base leading-snug">{eco.name}</CardTitle>
                    <button
                      onClick={(e) => { e.preventDefault(); handleDelete(eco.id, eco.name) }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    {eco.scrapeCount} scrape{eco.scrapeCount !== 1 ? "s" : ""}
                  </p>
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
