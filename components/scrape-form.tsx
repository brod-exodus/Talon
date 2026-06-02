"use client"

import type React from "react"

import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Settings, AlertCircle, Rocket, Plus, Search, ExternalLink } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useToast } from "@/hooks/use-toast"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { getStoredGithubToken } from "@/lib/client-secrets"
import { useAuthPermissions } from "@/lib/client-permissions"

type ProjectOption = {
  id: string
  name: string
}

type InvalidTargetError = {
  type: "organization" | "repository"
  target: string
  message: string
}

type ScrapeSourceType = "organization" | "repository"

export function ScrapeForm() {
  const searchParams = useSearchParams()
  const { canWrite } = useAuthPermissions()
  const [type, setType] = useState<ScrapeSourceType>("repository")
  const [target, setTarget] = useState("")
  const [minContributions, setMinContributions] = useState(1)
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState("none")
  const [creatingProject, setCreatingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState("")
  const [projectSaving, setProjectSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [invalidTargetError, setInvalidTargetError] = useState<InvalidTargetError | null>(null)
  const [existingTargets, setExistingTargets] = useState<Set<string>>(new Set())
  const targetInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  useEffect(() => {
    let cancelled = false
    fetch("/api/scrapes/recent?limit=50")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const completed = data.completed || []
        setExistingTargets(new Set(completed.map((s: { type: string; target: string }) => `${s.type}:${s.target}`)))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (searchParams.get("action") !== "start-scrape") return
    window.setTimeout(() => targetInputRef.current?.focus(), 0)
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    fetch("/api/ecosystems")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setProjects(
          Array.isArray(data)
            ? data.map((project: ProjectOption) => ({ id: project.id, name: project.name }))
            : []
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const isDuplicate = useMemo(() => {
    if (!target) return false
    return existingTargets.has(`${type}:${target}`)
  }, [target, type, existingTargets])

  const typeMismatch = useMemo<"looks-like-repo" | "looks-like-org" | null>(() => {
    if (!target.trim()) return null
    if (type === "organization" && target.includes("/")) return "looks-like-repo"
    if (type === "repository" && !target.includes("/")) return "looks-like-org"
    return null
  }, [target, type])

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  )

  const handleCreateProject = useCallback(async () => {
    if (!canWrite || !newProjectName.trim()) return
    setProjectSaving(true)
    try {
      const response = await fetch("/api/ecosystems", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName.trim() }),
      })
      const project = await response.json()
      if (!response.ok) {
        throw new Error(project?.error || "Failed to create project")
      }
      const nextProject = { id: project.id, name: project.name }
      setProjects((prev) => [nextProject, ...prev])
      setSelectedProjectId(nextProject.id)
      setNewProjectName("")
      setCreatingProject(false)
      toast({ title: "Project created", description: `${nextProject.name} is ready for scrapes.` })
    } catch (error) {
      toast({
        title: "Could not create project",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      })
    } finally {
      setProjectSaving(false)
    }
  }, [canWrite, newProjectName, toast])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()

      if (!canWrite) {
        toast({
          title: "Read-only access",
          description: "Your current role can view scrapes but cannot start new ones.",
          variant: "destructive",
        })
        return
      }

      const { token } = getStoredGithubToken()

      if (!token) {
        toast({
          title: "GitHub token required",
          description: "Please add your GitHub token in Settings first",
          variant: "destructive",
        })
        return
      }

      setIsLoading(true)

      try {
        const response = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            target: target.trim(),
            token,
            minContributions,
            projectId: selectedProjectId === "none" ? undefined : selectedProjectId,
          }),
        })

        if (!response.ok) {
          const error = await response.json().catch(() => null)
          if (error?.code === "github_target_not_found") {
            setInvalidTargetError({
              type,
              target: target.trim(),
              message: typeof error.message === "string"
                ? error.message
                : `We couldn't find "${target.trim()}" on GitHub. Check the spelling and try again.`,
            })
            return
          }
          throw new Error(error?.error || "Failed to start scrape")
        }

        const data = await response.json()

        const rateLimitMsg = data.rateLimit ? ` Rate limit: ${data.rateLimit.remaining}/${data.rateLimit.limit}` : ""
        const projectMsg = selectedProject ? ` Added to ${selectedProject.name}.` : ""
        toast({
          title: "Scrape queued",
          description: `Queued ${target} for processing.${projectMsg}${rateLimitMsg}`,
        })

        setTarget("")
      } catch (error) {
        console.error("[v0] Scrape error:", error)
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to start scrape",
          variant: "destructive",
        })
      } finally {
        setIsLoading(false)
      }
    },
    [canWrite, type, target, minContributions, selectedProjectId, selectedProject, toast],
  )

  const getPlaceholder = () => {
    switch (type) {
      case "organization":
        return "e.g. vercel"
      case "repository":
        return "owner/repo"
      default:
        return ""
    }
  }

  const getLabel = () => {
    switch (type) {
      case "organization":
        return "Owner/Organization"
      case "repository":
        return "Repository"
      default:
        return "Target"
    }
  }

  const openGitHubSearch = useCallback(() => {
    if (!invalidTargetError) return
    const searchType = invalidTargetError.type === "repository" ? "repositories" : "users"
    const url = `https://github.com/search?q=${encodeURIComponent(invalidTargetError.target)}&type=${searchType}`
    window.open(url, "_blank", "noopener,noreferrer")
  }, [invalidTargetError])

  const editInvalidTarget = useCallback(() => {
    setInvalidTargetError(null)
    window.setTimeout(() => targetInputRef.current?.focus(), 0)
  }, [])

  return (
    <>
    <Card className="sticky top-24 overflow-hidden">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
            <Rocket className="h-5 w-5" />
          </div>
          <div>
            <CardTitle className="text-xl font-extrabold">Start New Scrape</CardTitle>
            <CardDescription>Discover contributors with contact information.</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent>
      <form onSubmit={handleSubmit} className="space-y-4">
        {!canWrite && (
          <Alert>
            <AlertCircle className="h-4 w-4 text-primary" />
            <AlertDescription className="text-xs">
              Viewer access is read-only. Ask an admin to upgrade your role to start scrapes.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="type" className="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Source Type
          </Label>
          <Select value={type} onValueChange={(value) => setType(value as ScrapeSourceType)} disabled={!canWrite}>
            <SelectTrigger id="type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="repository">Repository</SelectItem>
              <SelectItem value="organization">Organization</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="target" className="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            {getLabel()}
          </Label>
          <Input
            ref={targetInputRef}
            id="target"
            placeholder={getPlaceholder()}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={!canWrite}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="minContributions" className="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Minimum Contributions
          </Label>
          <Input
            id="minContributions"
            type="number"
            min={1}
            value={minContributions}
            onChange={(e) => setMinContributions(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            disabled={!canWrite}
          />
          <p className="text-xs font-medium text-muted-foreground">
            Only include contributors with at least this many contributions
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="project" className="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Project
          </Label>
          <Select
            value={selectedProjectId}
            onValueChange={(value) => {
              if (value === "__create__") {
                setCreatingProject(true)
                return
              }
              setSelectedProjectId(value)
            }}
            disabled={!canWrite}
          >
            <SelectTrigger id="project" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No project</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
              <SelectItem value="__create__">
                <span className="flex items-center gap-2">
                  <Plus className="h-3.5 w-3.5" />
                  Create project
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs font-medium text-muted-foreground">
            Optional. Use projects to keep role-based searches organized.
          </p>
          {creatingProject && (
            <div className="flex gap-2">
              <Input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                placeholder="e.g. Staff Solana Engineer"
                disabled={!canWrite || projectSaving}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!newProjectName.trim() || projectSaving}
                onClick={handleCreateProject}
              >
                {projectSaving ? "Creating..." : "Create"}
              </Button>
            </div>
          )}
        </div>

        {typeMismatch === "looks-like-repo" && (
          <Alert className="border-blue-500/40 bg-blue-500/10">
            <AlertCircle className="h-4 w-4 text-blue-400 shrink-0" />
            <AlertDescription className="text-xs text-blue-300 flex flex-col gap-2">
              <span>This looks like a repository (owner/repo). You must select <strong>Repository</strong> as the source type.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start h-7 px-3 text-xs"
                onClick={() => setType("repository")}
              >
                Switch to Repository
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {typeMismatch === "looks-like-org" && (
          <Alert className="border-blue-500/40 bg-blue-500/10">
            <AlertCircle className="h-4 w-4 text-blue-400 shrink-0" />
            <AlertDescription className="text-xs text-blue-300 flex flex-col gap-2">
              <span>This looks like an organization name. You must select <strong>Organization</strong> as the source type.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start h-7 px-3 text-xs"
                onClick={() => setType("organization")}
              >
                Switch to Organization
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {isDuplicate && (
          <Alert className="border-yellow-500/50 bg-yellow-500/10">
            <AlertCircle className="h-4 w-4 text-yellow-500" />
            <AlertDescription className="text-xs text-yellow-500">
              You have already scraped this {type}. Scraping again will create a duplicate.
            </AlertDescription>
          </Alert>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={!canWrite || !target || isLoading}
        >
          {isLoading ? "Starting..." : "Start Scrape"}
        </Button>

        <Link href="/settings" className="block">
          <Button
            type="button"
            variant="ghost"
            className="w-full text-xs"
            size="sm"
          >
            <Settings className="w-3 h-3 mr-2" />
            Configure GitHub Token
          </Button>
        </Link>
      </form>
      </CardContent>
    </Card>
    <Dialog open={Boolean(invalidTargetError)} onOpenChange={(open) => !open && setInvalidTargetError(null)}>
      <DialogContent className="overflow-hidden border-primary/20 bg-card sm:max-w-md">
        <DialogHeader className="relative gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <DialogTitle className="text-xl font-extrabold">
              {invalidTargetError?.type === "repository" ? "Repository not found" : "Organization not found"}
            </DialogTitle>
            <DialogDescription className="mt-2 leading-relaxed">
              {invalidTargetError?.message}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter className="relative gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={openGitHubSearch} className="gap-2">
            <ExternalLink className="h-4 w-4" />
            Open GitHub search
          </Button>
          <Button type="button" onClick={editInvalidTarget}>
            Edit target
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
