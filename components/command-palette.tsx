"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Command } from "cmdk"
import {
  CircleDot,
  Database,
  Eye,
  FolderKanban,
  GitBranch,
  Home,
  Layers,
  Loader2,
  Rocket,
  Settings,
  Users,
} from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

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

const EMPTY_SEARCH_GROUPS: SearchGroups = {
  contributors: [],
  scrapes: [],
  projects: [],
  watchedRepos: [],
}

const SEARCH_GROUP_META = [
  { key: "contributors", label: "Contributors", icon: Users },
  { key: "scrapes", label: "Scrapes", icon: Database },
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "watchedRepos", label: "Watched repos", icon: GitBranch },
] as const

const NAVIGATE_ITEMS = [
  { label: "Dashboard", href: "/", icon: Home },
  { label: "Projects", href: "/ecosystems", icon: Layers },
  { label: "Watched Repos", href: "/watched", icon: Eye },
  { label: "Pipeline", href: "/pipeline", icon: CircleDot },
  { label: "Settings", href: "/settings", icon: Settings },
] as const

const QUICK_ACTIONS = [
  { label: "Start Scrape", href: "/?action=start-scrape", icon: Rocket },
  { label: "Add Watched Repo", href: "/watched?action=add", icon: Eye },
  { label: "Create Project", href: "/ecosystems?action=create", icon: FolderKanban },
] as const

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground outline-none data-[selected=true]:bg-primary/10 data-[selected=true]:text-primary"

const GROUP_HEADING_CLASS =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.16em] [&_[cmdk-group-heading]]:text-muted-foreground"

export function CommandPalette({
  open,
  onOpenChange,
  canWrite,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  canWrite: boolean
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchGroups>(EMPTY_SEARCH_GROUPS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setResults(EMPTY_SEARCH_GROUPS)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults(EMPTY_SEARCH_GROUPS)
      setLoading(false)
      setError(null)
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
        setResults({
          contributors: data?.groups?.contributors ?? [],
          scrapes: data?.groups?.scrapes ?? [],
          projects: data?.groups?.projects ?? [],
          watchedRepos: data?.groups?.watchedRepos ?? [],
        })
      } catch (fetchError) {
        if (fetchError instanceof DOMException && fetchError.name === "AbortError") return
        setResults(EMPTY_SEARCH_GROUPS)
        setError("Search is unavailable right now.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [query])

  const navigate = useCallback(
    (href: string) => {
      onOpenChange(false)
      router.push(href)
    },
    [onOpenChange, router]
  )

  const trimmedQuery = query.trim().toLowerCase()
  const matchesQuery = useCallback(
    (label: string) => trimmedQuery.length === 0 || label.toLowerCase().includes(trimmedQuery),
    [trimmedQuery]
  )

  const visibleNavigateItems = useMemo(() => NAVIGATE_ITEMS.filter((item) => matchesQuery(item.label)), [matchesQuery])
  const visibleQuickActions = useMemo(
    () => (canWrite ? QUICK_ACTIONS.filter((item) => matchesQuery(item.label)) : []),
    [canWrite, matchesQuery]
  )
  const searchResultCount = SEARCH_GROUP_META.reduce((count, group) => count + results[group.key].length, 0)
  const isEmpty =
    visibleNavigateItems.length === 0 && visibleQuickActions.length === 0 && searchResultCount === 0 && !loading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 gap-0 overflow-hidden rounded-lg border-border bg-popover p-0 shadow-none sm:max-w-xl">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command shouldFilter={false} label="Command palette">
          <div className="relative border-b border-border">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Search or jump to..."
              className="h-12 w-full bg-transparent px-4 pr-10 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
            />
            {loading && (
              <Loader2 className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary" />
            )}
          </div>
          <Command.List className={`max-h-[24rem] overflow-y-auto p-2 ${GROUP_HEADING_CLASS}`}>
            {error && <div className="px-3 py-4 text-sm text-destructive">{error}</div>}
            {isEmpty && !error && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {trimmedQuery.length > 0 ? `No results for "${query.trim()}".` : "Type to search Talon."}
              </div>
            )}
            {SEARCH_GROUP_META.map((group) => {
              const groupResults = results[group.key]
              if (groupResults.length === 0) return null
              const Icon = group.icon
              return (
                <Command.Group key={group.key} heading={group.label}>
                  {groupResults.map((result) => (
                    <Command.Item
                      key={`${group.key}-${result.id}`}
                      value={`${group.key}-${result.id}`}
                      onSelect={() => navigate(result.href)}
                      className={ITEM_CLASS}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{result.title}</span>
                        {result.subtitle && (
                          <span className="block truncate text-xs text-muted-foreground">{result.subtitle}</span>
                        )}
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )
            })}
            {visibleQuickActions.length > 0 && (
              <Command.Group heading="Quick actions">
                {visibleQuickActions.map((item) => {
                  const Icon = item.icon
                  return (
                    <Command.Item
                      key={item.href}
                      value={`action-${item.label}`}
                      onSelect={() => navigate(item.href)}
                      className={ITEM_CLASS}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {item.label}
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}
            {visibleNavigateItems.length > 0 && (
              <Command.Group heading="Navigate">
                {visibleNavigateItems.map((item) => {
                  const Icon = item.icon
                  return (
                    <Command.Item
                      key={item.href}
                      value={`nav-${item.label}`}
                      onSelect={() => navigate(item.href)}
                      className={ITEM_CLASS}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {item.label}
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

/** Global ⌘K / Ctrl+K listener for the command palette. */
export function useCommandPaletteShortcut(onOpen: () => void) {
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        onOpenRef.current()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])
}
