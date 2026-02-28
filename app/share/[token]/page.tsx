import { notFound } from "next/navigation"
import { Linkedin, Globe, ExternalLink, Calendar, Github } from "lucide-react"

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

async function fetchSharedScrape(token: string): Promise<SharedScrape | null> {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")

    const res = await fetch(`${baseUrl}/api/share/${token}`, { cache: "no-store" })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date))
}

// ─── X (Twitter) icon ────────────────────────────────────────────────────────
function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const scrape = await fetchSharedScrape(token)

  if (!scrape) notFound()

  const sorted = [...scrape.contributors]
    .filter((c) => {
      const con = c.contacts
      return !!(con?.email?.trim() || con?.twitter?.trim() || con?.linkedin?.trim() || con?.website?.trim())
    })
    .sort((a, b) => b.contributions - a.contributions)

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 sm:px-6 py-4 max-w-5xl flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest font-mono mb-0.5">Talon · Shared List</p>
            <h1 className="text-xl font-bold font-mono">{scrape.target}</h1>
          </div>
          <div className="text-right text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5 justify-end">
              <Calendar className="w-3.5 h-3.5" />
              {scrape.completedAt ? formatDate(scrape.completedAt) : "—"}
            </div>
            <p className="mt-0.5">
              <span className="font-mono text-foreground">{sorted.length}</span>
              {" "}contributor{sorted.length !== 1 ? "s" : ""} with contact info
            </p>
          </div>
        </div>
      </header>

      {/* ── Contributor list ─────────────────────────────────────────────── */}
      <main className="container mx-auto px-4 sm:px-6 py-8 max-w-5xl">
        {sorted.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            No contributors with contact information were found in this scrape.
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((contributor, idx) => {
              const con = contributor.contacts ?? {}
              return (
                <div
                  key={contributor.username}
                  className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-card hover:border-primary/30 transition-colors"
                >
                  {/* Row 1: avatar + name + GitHub button */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* rank badge */}
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
                    {con.email?.trim() && (
                      <a
                        href={`mailto:${con.email}`}
                        className="flex items-center gap-1.5 text-primary hover:underline font-mono"
                      >
                        <svg className="w-4 h-4 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                        </svg>
                        {con.email}
                      </a>
                    )}
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
