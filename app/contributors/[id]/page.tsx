"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  ArrowLeft,
  Building2,
  Calendar,
  ExternalLink,
  Github,
  Globe,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Save,
  StickyNote,
  X,
  type LucideIcon,
} from "lucide-react"
import { Header } from "@/components/header"
import { TalonScoreTooltipBody } from "@/components/talon-score-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuthMe, useAuthPermissions } from "@/lib/client-permissions"
import { getRecentlyViewedScope, recordRecentlyViewed } from "@/lib/recently-viewed"
import type { TalonScoreBreakdown } from "@/lib/talon-score"

type ContributorProfile = {
  id: string
  username: string
  name: string
  avatar: string
  bio: string | null
  location: string | null
  company: string | null
  contacts: {
    email?: string
    twitter?: string
    linkedin?: string
    website?: string
    github: string
  }
  notes: string | null
  notesUpdatedAt: string | null
  score: {
    value: number | null
    breakdown: TalonScoreBreakdown | null
    computedAt: string | null
  }
  reminder: {
    note: string | null
    date: string | null
    updatedAt: string | null
  }
  createdAt: string | null
  updatedAt: string | null
  projects: Array<{ id: string; name: string }>
  sources: Array<{
    scrapeId: string
    target: string
    type: string
    status: string
    contributions: number
    startedAt: string | null
    completedAt: string | null
    projects: Array<{ id: string; name: string }>
  }>
}

function formatDateTime(value: string | null) {
  if (!value) return null
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatDate(value: string | null) {
  if (!value) return null
  const date = value.includes("T") ? new Date(value) : new Date(`${value}T00:00:00`)
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

function getContactEntries(contributor: ContributorProfile) {
  return [
    contributor.contacts.email
      ? { label: "Email", value: contributor.contacts.email, href: `mailto:${contributor.contacts.email}`, icon: Mail }
      : null,
    contributor.contacts.linkedin
      ? { label: "LinkedIn", value: contributor.contacts.linkedin, href: contributor.contacts.linkedin, icon: Linkedin }
      : null,
    contributor.contacts.website
      ? { label: "Website", value: contributor.contacts.website, href: contributor.contacts.website, icon: Globe }
      : null,
    { label: "GitHub", value: contributor.contacts.github, href: contributor.contacts.github, icon: Github },
    contributor.contacts.twitter
      ? { label: "X", value: `@${contributor.contacts.twitter}`, href: `https://twitter.com/${contributor.contacts.twitter}`, icon: X }
      : null,
  ].filter((entry): entry is { label: string; value: string; href: string; icon: LucideIcon } => entry !== null)
}

export default function ContributorProfilePage() {
  const params = useParams<{ id: string }>()
  const me = useAuthMe()
  const permissions = useAuthPermissions()
  const canWrite = permissions.canWrite
  const contributorId = params.id
  const recentScope = getRecentlyViewedScope(me)

  const [contributor, setContributor] = useState<ContributorProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notesInput, setNotesInput] = useState("")
  const [linkedinInput, setLinkedinInput] = useState("")
  const [reminderNoteInput, setReminderNoteInput] = useState("")
  const [reminderDateInput, setReminderDateInput] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/contributors/${contributorId}`, { cache: "no-store" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Failed to load contributor")
      setContributor(data.contributor)
      setNotesInput(data.contributor.notes ?? "")
      setLinkedinInput(data.contributor.contacts?.linkedin ?? "")
      setReminderNoteInput(data.contributor.reminder?.note ?? "")
      setReminderDateInput(data.contributor.reminder?.date ?? "")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load contributor")
    } finally {
      setLoading(false)
    }
  }, [contributorId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!contributor) return
    recordRecentlyViewed(recentScope, {
      type: "contributor",
      id: contributor.id,
      title: contributor.name,
      subtitle: `@${contributor.username}`,
      href: `/contributors/${contributor.id}`,
    })
  }, [contributor, recentScope])

  const contactEntries = useMemo(() => (contributor ? getContactEntries(contributor) : []), [contributor])
  const totalContributions = useMemo(
    () => contributor?.sources.reduce((sum, source) => sum + source.contributions, 0) ?? 0,
    [contributor]
  )

  async function saveProfile(updates: Record<string, string | null>) {
    if (!canWrite || !contributor) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/contributors/${contributor.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Failed to save contributor")
      setContributor(data.contributor)
      setNotesInput(data.contributor.notes ?? "")
      setLinkedinInput(data.contributor.contacts?.linkedin ?? "")
      setReminderNoteInput(data.contributor.reminder?.note ?? "")
      setReminderDateInput(data.contributor.reminder?.date ?? "")
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save contributor")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="prism-app">
      <Header />
      <main className="prism-main">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>

        {loading ? (
          <ContributorProfileSkeleton />
        ) : error && !contributor ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="font-semibold text-foreground">Contributor could not load</p>
              <p className="mt-2 text-sm text-muted-foreground">{error}</p>
              <Button className="mt-4" variant="outline" onClick={load}>
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : contributor ? (
          <div className="space-y-6">
            {error && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {error}
              </div>
            )}

            <section className="rounded-3xl border border-white/70 bg-white/75 p-6 shadow-xl shadow-indigo-500/10 backdrop-blur-xl">
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 gap-4">
                  <img
                    src={contributor.avatar || "/placeholder.svg?height=96&width=96"}
                    alt={contributor.name}
                    className="h-20 w-20 shrink-0 rounded-3xl object-cover ring-1 ring-indigo-100"
                  />
                  <div className="min-w-0">
                    <h1 className="truncate text-3xl font-extrabold tracking-tight text-foreground">
                      {contributor.name}
                    </h1>
                    <a
                      href={contributor.contacts.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1.5 font-mono text-sm font-semibold text-primary hover:underline"
                    >
                      @{contributor.username}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <div className="mt-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
                      {contributor.company && (
                        <span className="inline-flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5" />
                          {contributor.company}
                        </span>
                      )}
                      {contributor.location && (
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5" />
                          {contributor.location}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm md:w-72">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="col-span-2 cursor-default rounded-2xl border border-primary/25 bg-primary/10 p-4">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Talon Score</p>
                        <p className="mt-1 text-2xl font-extrabold text-primary">
                          {contributor.score.value != null ? (
                            <>
                              {contributor.score.value}
                              <span className="text-sm font-bold text-muted-foreground"> / 100</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </p>
                        {contributor.score.value != null && (
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-primary" style={{ width: `${contributor.score.value}%` }} />
                          </div>
                        )}
                      </div>
                    </TooltipTrigger>
                    {contributor.score.breakdown && (
                      <TooltipContent>
                        <TalonScoreTooltipBody breakdown={contributor.score.breakdown} />
                      </TooltipContent>
                    )}
                  </Tooltip>
                  <div className="rounded-2xl border border-white/70 bg-white/70 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Sources</p>
                    <p className="mt-1 text-2xl font-extrabold">{contributor.sources.length}</p>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white/70 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Contribs</p>
                    <p className="mt-1 text-2xl font-extrabold">{totalContributions.toLocaleString()}</p>
                  </div>
                </div>
              </div>
              {contributor.bio && <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted-foreground">{contributor.bio}</p>}
            </section>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Notes</CardTitle>
                    <CardDescription>
                      {contributor.notesUpdatedAt ? `Updated ${formatDateTime(contributor.notesUpdatedAt)}` : "Private recruiter notes for this contributor."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {canWrite ? (
                      <>
                        <textarea
                          value={notesInput}
                          onChange={(event) => setNotesInput(event.target.value)}
                          placeholder="No notes yet"
                          className="min-h-32 w-full rounded-2xl border border-input bg-white/80 px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <Button disabled={saving} onClick={() => saveProfile({ notes: notesInput || null })}>
                          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          Save notes
                        </Button>
                      </>
                    ) : contributor.notes ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{contributor.notes}</p>
                    ) : (
                      <EmptyLine icon={StickyNote} text="No notes yet" />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Repos and source history</CardTitle>
                    <CardDescription>Scrapes where this contributor appeared.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {contributor.sources.length === 0 ? (
                      <EmptyLine icon={Github} text="No source history found" />
                    ) : (
                      <div className="space-y-3">
                        {contributor.sources.map((source) => (
                          <div key={source.scrapeId} className="rounded-2xl border border-border bg-white/70 p-4">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                              <div>
                                <p className="font-mono text-sm font-bold text-foreground">{source.target}</p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {source.type} · {source.status} · {source.contributions.toLocaleString()} contributions
                                </p>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {formatDate(source.completedAt ?? source.startedAt) ?? "No date"}
                              </p>
                            </div>
                            {source.projects.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {source.projects.map((project) => (
                                  <Link key={project.id} href={`/ecosystems/${project.id}`}>
                                    <Badge variant="secondary" className="cursor-pointer">
                                      {project.name}
                                    </Badge>
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Reminder</CardTitle>
                    <CardDescription>
                      {contributor.reminder.updatedAt ? `Updated ${formatDateTime(contributor.reminder.updatedAt)}` : "Create a lightweight follow-up reminder."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {contributor.reminder.date || contributor.reminder.note ? (
                      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                        <p className="flex items-center gap-2 text-sm font-extrabold text-foreground">
                          <Calendar className="h-4 w-4 text-primary" />
                          {formatDate(contributor.reminder.date) ?? "Reminder"}
                        </p>
                        {contributor.reminder.note && (
                          <p className="mt-2 text-sm text-muted-foreground">{contributor.reminder.note}</p>
                        )}
                      </div>
                    ) : (
                      <EmptyLine icon={Calendar} text="No reminder set" />
                    )}

                    {canWrite && (
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor="reminder-date">Reminder date</Label>
                          <Input
                            id="reminder-date"
                            type="date"
                            value={reminderDateInput}
                            onChange={(event) => setReminderDateInput(event.target.value)}
                            className="bg-white/80"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="reminder-note">Reminder note</Label>
                          <Input
                            id="reminder-note"
                            value={reminderNoteInput}
                            onChange={(event) => setReminderNoteInput(event.target.value)}
                            placeholder="Follow up about Staff Solana role"
                            className="bg-white/80"
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            disabled={saving}
                            onClick={() =>
                              saveProfile({
                                reminderDate: reminderDateInput || null,
                                reminderNote: reminderNoteInput || null,
                              })
                            }
                          >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Save
                          </Button>
                          <Button
                            variant="outline"
                            className="bg-white/80"
                            disabled={saving}
                            onClick={() => saveProfile({ reminderDate: null, reminderNote: null })}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Contact info</CardTitle>
                    <CardDescription>Scraped and manually curated contact fields.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {contactEntries.length === 1 && contactEntries[0]?.label === "GitHub" ? (
                      <EmptyLine icon={Mail} text="No contact info found" />
                    ) : null}
                    <div className="space-y-2">
                      {contactEntries.map((entry) => {
                        const Icon = entry.icon
                        return (
                          <a
                            key={entry.label}
                            href={entry.href}
                            target={entry.href.startsWith("mailto:") ? undefined : "_blank"}
                            rel={entry.href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
                            className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-white/70 px-3 py-2.5 text-sm transition-colors hover:border-primary/30 hover:bg-indigo-50/60"
                          >
                            <Icon className="h-4 w-4 shrink-0 text-primary" />
                            <span className="min-w-0">
                              <span className="block text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                                {entry.label}
                              </span>
                              <span className="block truncate font-semibold text-foreground">{entry.value}</span>
                            </span>
                          </a>
                        )
                      })}
                    </div>
                    {canWrite && (
                      <div className="space-y-2 border-t border-border pt-4">
                        <Label htmlFor="linkedin">LinkedIn</Label>
                        <div className="flex gap-2">
                          <Input
                            id="linkedin"
                            value={linkedinInput}
                            onChange={(event) => setLinkedinInput(event.target.value)}
                            placeholder="https://www.linkedin.com/in/..."
                            className="bg-white/80"
                          />
                          <Button
                            variant="outline"
                            disabled={saving}
                            className="bg-white/80"
                            onClick={() => saveProfile({ linkedin: linkedinInput || null })}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Related projects</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {contributor.projects.length === 0 ? (
                      <EmptyLine icon={Calendar} text="No related projects yet" />
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {contributor.projects.map((project) => (
                          <Link key={project.id} href={`/ecosystems/${project.id}`}>
                            <Badge variant="secondary" className="cursor-pointer">
                              {project.name}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}

function EmptyLine({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border bg-white/50 px-4 py-3 text-sm font-semibold text-muted-foreground">
      <Icon className="h-4 w-4" />
      {text}
    </div>
  )
}

function ContributorProfileSkeleton() {
  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/70 bg-white/75 p-6 shadow-xl shadow-indigo-500/10 backdrop-blur-xl">
        <div className="flex gap-4">
          <Skeleton className="h-20 w-20 rounded-3xl" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
        </div>
      </section>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Skeleton className="h-80 rounded-3xl" />
        <Skeleton className="h-80 rounded-3xl" />
      </div>
    </div>
  )
}
