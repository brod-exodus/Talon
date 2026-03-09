"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ArrowLeft, Trash2, Plus, X, ExternalLink, Linkedin, Globe, Mail
} from "lucide-react"

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

// ─── X icon ───────────────────────────────────────────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function EcosystemDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const [ecosystem, setEcosystem]       = useState<EcosystemDetail | null>(null)
  const [contributors, setContributors] = useState<EcosystemContributor[]>([])
  const [allScrapes, setAllScrapes]     = useState<ScrapeSummary[]>([])
  const [loading, setLoading]           = useState(true)
  const [selectedScrape, setSelectedScrape] = useState("")
  const [adding, setAdding]             = useState(false)

  const load = useCallback(async () => {
    const [ecoRes, scrapesRes] = await Promise.all([
      fetch(`/api/ecosystems/${id}`),
      fetch("/api/scrapes"),
    ])
    if (ecoRes.status === 404) { router.push("/ecosystems"); return }
    const { ecosystem: eco, contributors: contribs } = await ecoRes.json()
    const { completed } = await scrapesRes.json()
    setEcosystem(eco)
    setContributors(contribs ?? [])
    setAllScrapes(completed ?? [])
    setLoading(false)
  }, [id, router])

  useEffect(() => { load() }, [load])

  // scrapes not yet in this ecosystem
  const availableScrapes = allScrapes.filter(
    (s) => !ecosystem?.scrapes.some((es) => es.id === s.id)
  )

  async function handleAddScrape() {
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
    await fetch(`/api/ecosystems/${id}/scrapes`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scrapeId }),
    })
    await load()
  }

  async function handleDeleteEcosystem() {
    if (!confirm(`Delete ecosystem "${ecosystem?.name}"? This cannot be undone.`)) return
    await fetch(`/api/ecosystems/${id}`, { method: "DELETE" })
    router.push("/ecosystems")
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 sm:px-6 py-8 max-w-6xl space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
          <div className="space-y-3 mt-8">
            {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        </main>
      </div>
    )
  }

  if (!ecosystem) return null

  const uniqueContributors = contributors.length
  const multiScrapeCount   = contributors.filter(c => c.scrapeCount > 1).length

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 sm:px-6 py-8 max-w-6xl">

        {/* ── Breadcrumb / back ─────────────────────────────────────────── */}
        <Link
          href="/ecosystems"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Ecosystems
        </Link>

        {/* ── Header row ───────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-2">
          <h1 className="text-3xl font-bold tracking-tight">{ecosystem.name}</h1>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive gap-1.5"
            onClick={handleDeleteEcosystem}
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </Button>
        </div>

        {/* ── Stats bar ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-8">
          <span><span className="font-mono text-foreground">{ecosystem.scrapes.length}</span> scrapes</span>
          <span>·</span>
          <span><span className="font-mono text-foreground">{uniqueContributors}</span> contributors</span>
          {multiScrapeCount > 0 && (
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
            Scrapes in this Ecosystem
          </h2>

          {/* Scrape chips */}
          <div className="flex flex-wrap gap-2 mb-3">
            {ecosystem.scrapes.length === 0 && (
              <p className="text-sm text-muted-foreground">No scrapes added yet.</p>
            )}
            {ecosystem.scrapes.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full border border-border bg-card text-sm"
              >
                <span className="font-mono text-foreground">{s.target}</span>
                <span className="text-xs text-muted-foreground">· {s.contributorCount}</span>
                <button
                  onClick={() => handleRemoveScrape(s.id)}
                  className="ml-1 rounded-full p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  title="Remove from ecosystem"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Add scrape */}
          {availableScrapes.length > 0 && (
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
          <h2 className="text-base font-semibold mb-3 text-muted-foreground uppercase tracking-wide text-xs">
            Contributor Intelligence
          </h2>

          {contributors.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm border border-border rounded-lg bg-card">
              Add scrapes to see contributor intelligence.
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
                  {contributors.map((c, idx) => (
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
        </section>
      </main>
    </div>
  )
}
