"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Building2,
  Copy,
  FolderKanban,
  Github,
  GitBranch,
  Globe,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

type ContactInfo = {
  email?: string | null
  twitter?: string | null
  linkedin?: string | null
  website?: string | null
  github?: string | null
}

type ContributorPreviewProfile = {
  id: string
  username: string
  name: string
  avatar: string
  bio: string | null
  location: string | null
  company: string | null
  contacts: ContactInfo
  projects: Array<{ id: string; name: string }>
  sources: Array<{
    scrapeId: string
    target: string
    type: string
    status: string
    contributions: number
    projects: Array<{ id: string; name: string }>
  }>
}

export type ContributorPreviewSummary = {
  id: string
  username: string
  name?: string | null
  avatar?: string | null
  bio?: string | null
  location?: string | null
  company?: string | null
  contacts?: ContactInfo
  stats?: Array<{ label: string; value: string | number }>
  repositories?: string[]
  projects?: Array<{ id: string; name: string }>
  skills?: string[]
}

type ContributorQuickPreviewProps = {
  open: boolean
  contributor: ContributorPreviewSummary | null
  onOpenChange: (open: boolean) => void
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function hasValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function uniqueByName(projects: Array<{ id: string; name: string }>) {
  const seen = new Set<string>()
  return projects.filter((project) => {
    if (seen.has(project.id)) return false
    seen.add(project.id)
    return true
  })
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value)
}

export function ContributorQuickPreview({ open, contributor, onOpenChange }: ContributorQuickPreviewProps) {
  const { toast } = useToast()
  const [profile, setProfile] = useState<ContributorPreviewProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !contributor?.id) return

    let cancelled = false
    const controller = new AbortController()
    const contributorId = contributor.id

    async function loadProfile() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/contributors/${contributorId}`, {
          cache: "no-store",
          signal: controller.signal,
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.error || "Contributor could not load")
        if (!cancelled) setProfile(data.contributor ?? null)
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        if (!cancelled) setError("Full contributor details are unavailable right now.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadProfile()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [open, contributor?.id])

  useEffect(() => {
    if (!open) {
      setProfile(null)
      setError(null)
      setLoading(false)
    }
  }, [open])

  const display = {
    id: profile?.id ?? contributor?.id ?? "",
    username: profile?.username ?? contributor?.username ?? "",
    name: profile?.name ?? contributor?.name ?? contributor?.username ?? "Contributor",
    avatar: profile?.avatar ?? contributor?.avatar ?? "",
    bio: profile?.bio ?? contributor?.bio ?? null,
    location: profile?.location ?? contributor?.location ?? null,
    company: profile?.company ?? contributor?.company ?? null,
    contacts: {
      ...contributor?.contacts,
      ...profile?.contacts,
    },
  }

  const githubUrl = display.contacts.github || (display.username ? `https://github.com/${display.username}` : "")
  const repositories = useMemo(() => {
    const sourceTargets = profile?.sources.map((source) => source.target) ?? []
    return Array.from(new Set([...(contributor?.repositories ?? []), ...sourceTargets])).filter(Boolean)
  }, [contributor?.repositories, profile?.sources])
  const projects = useMemo(() => {
    const sourceProjects = profile?.sources.flatMap((source) => source.projects) ?? []
    return uniqueByName([...(contributor?.projects ?? []), ...(profile?.projects ?? []), ...sourceProjects])
  }, [contributor?.projects, profile?.projects, profile?.sources])
  const totalContributions = profile?.sources.reduce((sum, source) => sum + source.contributions, 0)
  const stats = useMemo(() => {
    const base = contributor?.stats ?? []
    if (!profile) return base
    return [
      { label: "Repos", value: profile.sources.length },
      { label: "Contributions", value: formatNumber(totalContributions ?? 0) },
      { label: "Projects", value: projects.length },
    ]
  }, [contributor?.stats, profile, projects.length, totalContributions])
  const skills = contributor?.skills ?? []
  const email = hasValue(display.contacts.email) ? display.contacts.email.trim() : ""

  async function copyEmail() {
    if (!email) return
    await navigator.clipboard.writeText(email)
    toast({ title: "Email copied", description: email })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="left-auto right-0 top-0 h-screen max-w-xl translate-x-0 translate-y-0 overflow-y-auto rounded-none border-white/70 bg-white/95 p-0 shadow-2xl shadow-indigo-500/20 backdrop-blur-xl sm:rounded-none">
        <div className="p-6">
          <DialogHeader className="pr-8">
            <DialogTitle>Contributor preview</DialogTitle>
            <DialogDescription>Quick context for fast recruiter triage.</DialogDescription>
          </DialogHeader>

          <div className="mt-6 space-y-6">
            <section className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-sm shadow-indigo-500/5">
              <div className="flex items-start gap-4">
                <img
                  src={display.avatar || "/placeholder.svg?height=80&width=80"}
                  alt={display.name}
                  className="h-16 w-16 rounded-full object-cover ring-2 ring-white"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-xl font-extrabold text-foreground">{display.name}</h3>
                  <p className="font-mono text-sm font-semibold text-muted-foreground">@{display.username}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {display.company && (
                      <Badge variant="secondary" className="gap-1">
                        <Building2 className="h-3 w-3" />
                        {display.company}
                      </Badge>
                    )}
                    {display.location && (
                      <Badge variant="outline" className="gap-1 bg-white/70">
                        <MapPin className="h-3 w-3" />
                        {display.location}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {display.bio ? (
                <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{display.bio}</p>
              ) : (
                <p className="mt-5 text-sm font-medium text-muted-foreground">No bio found yet.</p>
              )}

              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                <Button asChild>
                  <Link href={`/contributors/${display.id}`} onClick={() => onOpenChange(false)}>
                    Open Full Profile
                  </Link>
                </Button>
                <Button type="button" variant="outline" onClick={copyEmail} disabled={!email} className="bg-white/80">
                  <Copy className="h-4 w-4" />
                  Copy Email
                </Button>
                <Button asChild variant="outline" className="bg-white/80">
                  <a href={githubUrl} target="_blank" rel="noopener noreferrer">
                    <Github className="h-4 w-4" />
                    Open GitHub
                  </a>
                </Button>
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-3">
              {stats.length > 0 ? (
                stats.map((stat) => (
                  <div key={stat.label} className="rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm shadow-indigo-500/5">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{stat.label}</p>
                    <p className="mt-2 text-lg font-extrabold text-foreground">{stat.value}</p>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-white/70 bg-white/70 p-4 text-sm font-semibold text-muted-foreground sm:col-span-3">
                  Contribution stats are not available for this list.
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-sm shadow-indigo-500/5">
              <h4 className="text-sm font-extrabold text-foreground">Contact info</h4>
              <div className="mt-3 space-y-2 text-sm">
                {email && (
                  <a href={`mailto:${email}`} className="flex items-center gap-2 text-primary hover:underline">
                    <Mail className="h-4 w-4" />
                    {email}
                  </a>
                )}
                {hasValue(display.contacts.linkedin) && (
                  <a href={display.contacts.linkedin} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                    <Linkedin className="h-4 w-4" />
                    LinkedIn
                  </a>
                )}
                {hasValue(display.contacts.twitter) && (
                  <a href={`https://twitter.com/${display.contacts.twitter}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                    <XIcon className="h-4 w-4" />
                    @{display.contacts.twitter}
                  </a>
                )}
                {hasValue(display.contacts.website) && (
                  <a href={display.contacts.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-primary hover:underline">
                    <Globe className="h-4 w-4" />
                    Website
                  </a>
                )}
                {!email && !display.contacts.linkedin && !display.contacts.twitter && !display.contacts.website && (
                  <p className="font-medium text-muted-foreground">No contact info found.</p>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-sm shadow-indigo-500/5">
              <h4 className="text-sm font-extrabold text-foreground">Languages / skills</h4>
              <div className="mt-3 flex flex-wrap gap-2">
                {skills.length > 0 ? (
                  skills.map((skill) => (
                    <Badge key={skill} variant="secondary">
                      {skill}
                    </Badge>
                  ))
                ) : (
                  <p className="text-sm font-medium text-muted-foreground">No language or skill signals available yet.</p>
                )}
              </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-sm shadow-indigo-500/5">
                <h4 className="flex items-center gap-2 text-sm font-extrabold text-foreground">
                  <GitBranch className="h-4 w-4 text-primary" />
                  Repos
                </h4>
                <div className="mt-3 flex flex-wrap gap-2">
                  {repositories.length > 0 ? (
                    repositories.slice(0, 8).map((repo) => (
                      <Badge key={repo} variant="outline" className="max-w-full bg-white/70 font-mono">
                        <span className="truncate">{repo}</span>
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm font-medium text-muted-foreground">No linked repos found.</p>
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-sm shadow-indigo-500/5">
                <h4 className="flex items-center gap-2 text-sm font-extrabold text-foreground">
                  <FolderKanban className="h-4 w-4 text-primary" />
                  Projects
                </h4>
                <div className="mt-3 flex flex-wrap gap-2">
                  {projects.length > 0 ? (
                    projects.slice(0, 8).map((project) => (
                      <Badge key={project.id} variant="secondary" className="max-w-full">
                        <span className="truncate">{project.name}</span>
                      </Badge>
                    ))
                  ) : (
                    <p className="text-sm font-medium text-muted-foreground">No linked projects found.</p>
                  )}
                </div>
              </div>
            </section>

            {loading && (
              <div className="flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm font-semibold text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading full contributor context...
              </div>
            )}
            {error && (
              <div className={cn("rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700")}>
                {error}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
