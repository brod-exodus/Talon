"use client"

import { useState, useEffect, useMemo } from "react"
import { useParams } from "next/navigation"
import { Linkedin, Globe, Calendar, Github } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CopyableEmail } from "./copyable-email"

// ─── Types ────────────────────────────────────────────────────────────────────

type Contact = {
  email?: string
  twitter?: string
  linkedin?: string
  website?: string
}

type Contributor = {
  id: string
  username: string
  name: string
  avatar: string
  contributions: number
  bio?: string
  location?: string
  company?: string
  contacts: Contact
}

type SharedScrape = {
  id: string
  type: string
  target: string
  completedAt?: string
  contributors: Contributor[]
}

type ContactFilter = "email" | "linkedin" | "twitter"
type SortOrder = "high-low" | "low-high"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasContactInfo(c: Contributor) {
  return !!(
    c.contacts?.email?.trim() ||
    c.contacts?.twitter?.trim() ||
    c.contacts?.linkedin?.trim() ||
    c.contacts?.website?.trim()
  )
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date))
}

// ─── X icon ───────────────────────────────────────────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SharePage() {
  const params = useParams()
  const token = params.token as string

  const [scrape, setScrape] = useState<SharedScrape | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [activeFilters, setActiveFilters] = useState<Set<ContactFilter>>(new Set())
  const [sortOrder, setSortOrder] = useState<SortOrder>("high-low")

  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then((res) => {
        if (res.status === 404) { setNotFound(true); return null }
        if (!res.ok) throw new Error("Failed to load")
        return res.json()
      })
      .then((data) => { if (data) setScrape(data) })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  function toggleFilter(filter: ContactFilter) {
    setActiveFilters((prev) => {
      const next = new Set(prev)
      if (next.has(filter)) next.delete(filter)
      else next.add(filter)
      return next
    })
  }

  // All contributors that have at least one contact field
  const withContacts = useMemo(
    () => (scrape ? scrape.contributors.filter(hasContactInfo) : []),
    [scrape]
  )

  // Apply active filters (AND logic) then sort
  const visible = useMemo(() => {
    let result = withContacts
    if (activeFilters.has("email"))    result = result.filter((c) => c.contacts?.email?.trim())
    if (activeFilters.has("linkedin")) result = result.filter((c) => c.contacts?.linkedin?.trim())
    if (activeFilters.has("twitter"))  result = result.filter((c) => c.contacts?.twitter?.trim())
    return [...result].sort((a, b) =>
      sortOrder === "high-low" ? b.contributions - a.contributions : a.contributions - b.contributions
    )
  }, [withContacts, activeFilters, sortOrder])

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3 text-muted-foreground">
          <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    )
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (notFound || !scrape) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-2xl font-bold">404</p>
          <p className="text-muted-foreground text-sm">This shared list does not exist or has been deleted.</p>
        </div>
      </div>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Sticky header ──────────────────────────────────────────────── */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 sm:px-6 py-4 max-w-5xl flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-mono mb-0.5">
              Talon · Shared List
            </p>
            <h1 className="text-xl font-bold font-mono">{scrape.target}</h1>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5 justify-end">
              <Calendar className="w-3.5 h-3.5" />
              {scrape.completedAt ? formatDate(scrape.completedAt) : "—"}
            </div>
            <p className="mt-0.5">
              <span className="font-mono text-foreground">{withContacts.length}</span>
              {" "}contributor{withContacts.length !== 1 ? "s" : ""} with contact info
            </p>
          </div>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <main className="container mx-auto px-4 sm:px-6 py-8 max-w-5xl">

        {/* ── Filter / sort controls ──────────────────────────────────── */}
        <div className="flex flex-col gap-2 mb-5 pb-4 border-b border-border">
          <div className="flex flex-wrap items-center gap-4">
            {/* Checkboxes */}
            <div className="flex items-center gap-4">
              {(
                [
                  { key: "email",    label: "Email" },
                  { key: "linkedin", label: "LinkedIn" },
                  { key: "twitter",  label: "X" },
                ] as const
              ).map(({ key, label }) => (
                <label key={key} className="flex items-center gap-1.5 cursor-pointer select-none group">
                  <input
                    type="checkbox"
                    checked={activeFilters.has(key)}
                    onChange={() => toggleFilter(key)}
                    className="h-3.5 w-3.5 rounded border border-border bg-background accent-primary cursor-pointer"
                  />
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                    {label}
                  </span>
                </label>
              ))}
            </div>

            <div className="flex-1" />

            {/* Sort */}
            <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as SortOrder)}>
              <SelectTrigger className="h-7 w-52 text-xs bg-transparent border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="high-low">Contributions (High to Low)</SelectItem>
                <SelectItem value="low-high">Contributions (Low to High)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Count */}
          <p className="text-xs text-muted-foreground">
            {visible.length} of {withContacts.length} contributors
            {activeFilters.size > 0 && " (filtered)"}
          </p>
        </div>

        {/* ── Contributor list ─────────────────────────────────────────── */}
        {visible.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            {activeFilters.size > 0
              ? "No contributors match the active filters."
              : "No contributors with contact information were found in this scrape."}
          </div>
        ) : (
          <div className="space-y-3">
            {visible.map((contributor, idx) => {
              const con = contributor.contacts ?? {}
              return (
                <div
                  key={contributor.username}
                  className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-card hover:border-primary/30 transition-colors"
                >
                  {/* Row 1: avatar + name + GitHub */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground w-6 text-right shrink-0">
                        {idx + 1}
                      </span>
                      <img
                        src={contributor.avatar || "/placeholder.svg?height=40&width=40"}
                        alt={contributor.name}
                        className="w-10 h-10 rounded-full ring-2 ring-border"
                      />
                      <div>
                        <p className="font-semibold text-foreground">{contributor.name}</p>
                        <p className="text-sm text-muted-foreground font-mono">
                          @{contributor.username} · {contributor.contributions} contributions
                        </p>
                      </div>
                    </div>
                    <a
                      href={`https://github.com/${contributor.username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs border border-border rounded-md px-2.5 py-1.5 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors bg-transparent"
                    >
                      <Github className="w-3.5 h-3.5" />
                      GitHub
                    </a>
                  </div>

                  {/* Row 2: contact links */}
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5 pl-[3.75rem] text-sm">
                    {con.email?.trim() && <CopyableEmail email={con.email} />}
                    {con.linkedin?.trim() && (
                      <a
                        href={con.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-primary hover:underline font-mono"
                      >
                        <Linkedin className="w-4 h-4 shrink-0 text-muted-foreground" />
                        {con.linkedin.split("/").filter(Boolean).pop()}
                      </a>
                    )}
                    {con.twitter?.trim() && (
                      <a
                        href={`https://twitter.com/${con.twitter}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-primary hover:underline font-mono"
                      >
                        <XIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                        @{con.twitter}
                      </a>
                    )}
                    {con.website?.trim() && (
                      <a
                        href={con.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-primary hover:underline font-mono"
                      >
                        <Globe className="w-4 h-4 shrink-0 text-muted-foreground" />
                        {con.website}
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border mt-16 py-6 text-center text-xs text-muted-foreground">
        Generated by{" "}
        <span className="font-semibold text-foreground">Talon</span>
        {" "}· Read-only shared view
      </footer>
    </div>
  )
}
