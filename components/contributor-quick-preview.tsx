"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Building2,
  BookmarkPlus,
  Check,
  Copy,
  CheckCircle2,
  FolderKanban,
  Github,
  GitBranch,
  Globe,
  Linkedin,
  Loader2,
  Mail,
  MapPin,
  Plus,
} from "lucide-react"
import {
  ProjectOutreachBadge,
  ProjectOutreachForm,
  type ProjectContributorTracking,
  type ProjectTrackingUpdate,
} from "@/components/project-outreach"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  currentProject?: { id: string; name: string } | null
  currentProjectTracking?: ProjectContributorTracking | null
  projectOptions?: Array<{ id: string; name: string }>
  canSaveToList?: boolean
  canUpdateProjectTracking?: boolean
  trackingSaving?: boolean
  onUpdateProjectTracking?: (contributorId: string, updates: ProjectTrackingUpdate) => Promise<ProjectContributorTracking | null> | ProjectContributorTracking | null | void
}

type ProjectListSummary = {
  id: string
  projectId: string
  name: string
  contributorCount: number
  contributorIds: string[]
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

export function ContributorQuickPreview({
  open,
  contributor,
  onOpenChange,
  currentProject = null,
  currentProjectTracking = null,
  projectOptions = [],
  canSaveToList = false,
  canUpdateProjectTracking = false,
  trackingSaving = false,
  onUpdateProjectTracking,
}: ContributorQuickPreviewProps) {
  const { toast } = useToast()
  const [profile, setProfile] = useState<ContributorPreviewProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [projectLists, setProjectLists] = useState<ProjectListSummary[]>([])
  const [selectedListId, setSelectedListId] = useState("")
  const [newListName, setNewListName] = useState("")
  const [listsLoading, setListsLoading] = useState(false)
  const [listSaving, setListSaving] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [outreachSavedAt, setOutreachSavedAt] = useState<Date | null>(null)
  const [outreachSaveError, setOutreachSaveError] = useState<string | null>(null)

  const projectChoices = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>()
    if (currentProject) byId.set(currentProject.id, currentProject)
    for (const project of projectOptions) byId.set(project.id, project)
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [currentProject, projectOptions])

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
      setSelectedProjectId("")
      setProjectLists([])
      setSelectedListId("")
      setNewListName("")
      setListError(null)
      setOutreachSavedAt(null)
      setOutreachSaveError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setSelectedProjectId(currentProject?.id ?? "")
  }, [currentProject?.id, open])

  useEffect(() => {
    if (!open || !selectedProjectId) {
      setProjectLists([])
      setSelectedListId("")
      return
    }

    let cancelled = false
    const controller = new AbortController()

    async function loadProjectLists() {
      setListsLoading(true)
      setListError(null)
      try {
        const response = await fetch(`/api/ecosystems/${selectedProjectId}/lists`, {
          cache: "no-store",
          signal: controller.signal,
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.error || "Project lists could not load")
        if (cancelled) return
        const lists = Array.isArray(data?.lists) ? data.lists : []
        setProjectLists(lists)
        setSelectedListId((current) =>
          current && lists.some((list: ProjectListSummary) => list.id === current) ? current : ""
        )
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        if (!cancelled) {
          setProjectLists([])
          setSelectedListId("")
          setListError("Lists could not load for this Project.")
        }
      } finally {
        if (!cancelled) setListsLoading(false)
      }
    }

    loadProjectLists()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [open, selectedProjectId])

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
  const selectedList = useMemo(
    () => projectLists.find((list) => list.id === selectedListId) ?? null,
    [projectLists, selectedListId]
  )
  const selectedListHasContributor = Boolean(
    selectedList && display.id && selectedList.contributorIds.includes(display.id)
  )

  async function copyEmail() {
    if (!email) return
    await navigator.clipboard.writeText(email)
    toast({ title: "Email copied", description: email })
  }

  async function createList() {
    if (!selectedProjectId || !newListName.trim()) return
    setListSaving(true)
    setListError(null)
    try {
      const response = await fetch(`/api/ecosystems/${selectedProjectId}/lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newListName.trim() }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "List could not be created")
      const list = data.list as ProjectListSummary
      setProjectLists((prev) => [list, ...prev])
      setSelectedListId(list.id)
      setNewListName("")
      toast({ title: "List created", description: list.name })
    } catch (err) {
      setListError(err instanceof Error ? err.message : "List could not be created")
    } finally {
      setListSaving(false)
    }
  }

  async function saveToList() {
    if (!display.id || !selectedProjectId || !selectedListId) return
    if (selectedListHasContributor) {
      toast({
        title: "Already saved",
        description: `${display.name} is already in ${selectedList?.name ?? "that list"}.`,
      })
      return
    }
    setListSaving(true)
    setListError(null)
    try {
      const response = await fetch(`/api/ecosystems/${selectedProjectId}/lists/${selectedListId}/contributors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contributorId: display.id }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Contributor could not be saved")
      const listName = projectLists.find((list) => list.id === selectedListId)?.name ?? "list"
      setProjectLists((prev) =>
        prev.map((list) =>
          list.id === selectedListId ? { ...list, contributorCount: list.contributorCount + 1 } : list
        )
      )
      toast({ title: "Saved to list", description: `${display.name} was saved to ${listName}.` })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Contributor could not be saved"
      if (message.includes("already")) {
        toast({ title: "Already saved", description: `${display.name} is already in that list.` })
      } else {
        setListError(message)
      }
    } finally {
      setListSaving(false)
    }
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

            {canSaveToList && (
              <section className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-sm shadow-indigo-500/5">
                <div className="flex items-center gap-2">
                  <BookmarkPlus className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-extrabold text-foreground">Save to Project list</h4>
                </div>
                <div className="mt-4 space-y-4">
                  {!currentProject && (
                    <div className="space-y-2">
                      <Label>Project</Label>
                      {projectChoices.length > 0 ? (
                        <Select value={selectedProjectId || undefined} onValueChange={setSelectedProjectId}>
                          <SelectTrigger className="w-full bg-white/80">
                            <SelectValue placeholder="Choose a Project first" />
                          </SelectTrigger>
                          <SelectContent>
                            {projectChoices.map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                {project.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700">
                          Choose or create a Project before saving contributors to lists.
                        </p>
                      )}
                    </div>
                  )}

                  {selectedProjectId && (
                    <>
                      <div className="space-y-2">
                        <Label>List</Label>
                        {listsLoading ? (
                          <div className="flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm font-semibold text-primary">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading lists...
                          </div>
                        ) : projectLists.length > 0 ? (
                          <Select value={selectedListId || undefined} onValueChange={setSelectedListId}>
                            <SelectTrigger className="w-full bg-white/80">
                              <SelectValue placeholder="Save to list..." />
                            </SelectTrigger>
                            <SelectContent>
                              {projectLists.map((list) => (
                                <SelectItem key={list.id} value={list.id}>
                                  <div className="flex w-full min-w-0 items-center justify-between gap-2">
                                    <span className="truncate">{list.name}</span>
                                    {display.id && list.contributorIds.includes(display.id) && (
                                      <Check className="h-3.5 w-3.5 text-muted-foreground" />
                                    )}
                                  </div>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <p className="text-sm font-medium text-muted-foreground">
                            No lists in this Project yet. Create one below.
                          </p>
                        )}
                      </div>

                      <div className="flex gap-2">
                        <Input
                          value={newListName}
                          onChange={(event) => setNewListName(event.target.value)}
                          placeholder="New list name"
                          maxLength={120}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={createList}
                          disabled={listSaving || !newListName.trim()}
                          className="bg-white/80"
                        >
                          <Plus className="h-4 w-4" />
                          Create
                        </Button>
                      </div>

                      <Button
                        type="button"
                        onClick={saveToList}
                        disabled={listSaving || !selectedListId || selectedListHasContributor}
                        className="w-full"
                      >
                        {listSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />}
                        {selectedListHasContributor ? "Already in list" : "Save Contributor"}
                      </Button>
                    </>
                  )}

                  {listError && (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                      {listError}
                    </div>
                  )}
                </div>
              </section>
            )}

            {currentProject && currentProjectTracking && (
              <section className="rounded-3xl border border-white/70 bg-white/75 p-5 shadow-sm shadow-indigo-500/5">
                <div className="flex items-center gap-2">
                  <FolderKanban className="h-4 w-4 text-primary" />
                  <h4 className="text-sm font-extrabold text-foreground">Project outreach</h4>
                </div>
                <p className="mt-1 text-xs font-semibold text-muted-foreground">
                  Tracking for {currentProject.name}
                </p>
                <div className="mt-4">
                  {canUpdateProjectTracking && onUpdateProjectTracking ? (
                    <div className="space-y-3">
                      <ProjectOutreachForm
                        tracking={currentProjectTracking}
                        saving={trackingSaving}
                        onSave={async (updates) => {
                          setOutreachSaveError(null)
                          try {
                            const result = await onUpdateProjectTracking(display.id, updates)
                            if (result === null) {
                              const message = "Outreach details could not be saved. Please try again."
                              setOutreachSaveError(message)
                              toast({
                                title: "Save failed",
                                description: message,
                                variant: "destructive",
                              })
                              return
                            }
                            setOutreachSavedAt(new Date())
                            toast({
                              title: "Outreach saved",
                              description: "Notes and follow-up details were updated.",
                            })
                          } catch (error) {
                            const message =
                              error instanceof Error && error.message.trim()
                                ? error.message
                                : "Outreach details could not be saved. Please try again."
                            setOutreachSaveError(message)
                            toast({
                              title: "Save failed",
                              description: message,
                              variant: "destructive",
                            })
                          }
                        }}
                      />
                      {outreachSaveError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">
                          {outreachSaveError}
                        </div>
                      ) : outreachSavedAt ? (
                        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Saved just now
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-3 text-sm text-muted-foreground">
                      <ProjectOutreachBadge status={currentProjectTracking.status} />
                      <p>{currentProjectTracking.notes || "No project outreach notes yet."}</p>
                    </div>
                  )}
                </div>
              </section>
            )}

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
