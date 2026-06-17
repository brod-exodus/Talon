"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Command } from "cmdk"
import { CircleDot, Database, Eye, FolderKanban, Home, Loader2, Plus, Search, Settings, Users, X } from "lucide-react"

type SearchResult = {
  id: string
  title: string
  subtitle?: string
  href: string
}

type SearchGroups = {
  contributors: SearchResult[]
  scrapes: SearchResult[]
  projects: SearchResult[]
  watchedRepos: SearchResult[]
}

const EMPTY_GROUPS: SearchGroups = { contributors: [], scrapes: [], projects: [], watchedRepos: [] }

const BASE_ACTIONS = [
  { id: "dashboard", label: "Open Dashboard", hint: "Workspace", href: "/", icon: Home },
  { id: "projects", label: "Open Projects", hint: "Project library", href: "/ecosystems", icon: FolderKanban },
  { id: "watched", label: "Open Watched Repos", hint: "Automation", href: "/watched", icon: Eye },
  { id: "pipeline", label: "Open Pipeline", hint: "Outreach workflow", href: "/pipeline", icon: CircleDot },
  { id: "settings", label: "Open Settings", hint: "Account and team", href: "/settings", icon: Settings },
]

const WRITE_ACTIONS = [
  { id: "start-scrape", label: "Start Scrape", hint: "Dashboard action", href: "/", icon: Plus },
  { id: "create-project", label: "Create Project", hint: "Project action", href: "/ecosystems?action=create", icon: FolderKanban },
  { id: "add-watched-repo", label: "Add Watched Repo", hint: "Watched repo action", href: "/watched?action=add", icon: Eye },
]

const SEARCH_GROUPS = [
  { key: "contributors", label: "Contributors", icon: Users },
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "scrapes", label: "Scrapes", icon: Database },
  { key: "watchedRepos", label: "Watched Repos", icon: Eye },
] as const

function isModK(event: KeyboardEvent) {
  return event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)
}

export function CommandPalette({ canWrite = false }: { canWrite?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [groups, setGroups] = useState<SearchGroups>(EMPTY_GROUPS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const actions = useMemo(() => (canWrite ? [...WRITE_ACTIONS, ...BASE_ACTIONS] : BASE_ACTIONS), [canWrite])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isModK(event)) return
      event.preventDefault()
      setOpen((current) => !current)
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setGroups(EMPTY_GROUPS)
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          cache: "no-store",
          signal: controller.signal,
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.error || "Search failed")
        setGroups(data?.groups ?? EMPTY_GROUPS)
      } catch (err) {
        if ((err as Error).name === "AbortError") return
        setGroups(EMPTY_GROUPS)
        setError("Search is unavailable right now.")
      } finally {
        setLoading(false)
      }
    }, 180)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [open, query])

  function navigate(href: string) {
    setOpen(false)
    setQuery("")
    router.push(href)
  }

  const hasSearchResults = SEARCH_GROUPS.some((group) => groups[group.key].length > 0)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-9 items-center gap-2 rounded-md border border-border bg-card px-3 font-mono text-xs text-muted-foreground transition hover:border-primary/35 hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:inline-flex"
        aria-label="Open command palette"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Command</span>
        <kbd className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
      </button>

      <Command.Dialog
        open={open}
        onOpenChange={setOpen}
        label="Talon command palette"
        contentClassName="fixed left-1/2 top-[14vh] z-[70] w-[min(640px,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-popover shadow-none outline-none"
        overlayClassName="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm"
        className="bg-popover text-popover-foreground"
        shouldFilter={false}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Command.Input
            value={query}
            onValueChange={setQuery}
            placeholder="Search contributors, projects, repos, or actions..."
            className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Close command palette"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <Command.List className="max-h-[28rem] overflow-y-auto p-2">
          {error && <div className="px-3 py-4 text-sm text-destructive">{error}</div>}

          <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-muted-foreground">
            {actions.map((action) => {
              const Icon = action.icon
              return (
                <Command.Item
                  key={action.id}
                  value={action.label}
                  onSelect={() => navigate(action.href)}
                  className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">{action.label}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{action.hint}</span>
                </Command.Item>
              )
            })}
          </Command.Group>

          {SEARCH_GROUPS.map((group) => {
            const results = groups[group.key]
            if (results.length === 0) return null
            const Icon = group.icon
            return (
              <Command.Group key={group.key} heading={group.label} className="mt-2 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-muted-foreground">
                {results.map((result) => (
                  <Command.Item
                    key={`${group.key}-${result.id}`}
                    value={`${result.title} ${result.subtitle ?? ""}`}
                    onSelect={() => navigate(result.href)}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm transition data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{result.title}</span>
                      {result.subtitle && <span className="block truncate font-mono text-[11px] text-muted-foreground">{result.subtitle}</span>}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )
          })}

          {query.trim().length >= 2 && !loading && !error && !hasSearchResults && (
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matching Talon records.
            </Command.Empty>
          )}
        </Command.List>
      </Command.Dialog>
    </>
  )
}
