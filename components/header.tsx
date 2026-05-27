"use client"

import Link from "next/link"
import Image from "next/image"
import { type ChangeEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  AlertTriangle,
  Bell,
  Camera,
  CheckCircle2,
  CircleDot,
  Clock,
  Database,
  Eye,
  FolderKanban,
  GitBranch,
  Home,
  Layers,
  Loader2,
  LogOut,
  Menu,
  Plus,
  Rocket,
  Search,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  UserCircle,
  Users,
  X,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AUTH_ME_REFRESH_EVENT, type AuthMe, useAuthMe } from "@/lib/client-permissions"
import {
  getRecentlyViewedItems,
  getRecentlyViewedScope,
  RECENTLY_VIEWED_EVENT,
  type RecentlyViewedItem,
} from "@/lib/recently-viewed"
import { cn } from "@/lib/utils"

const ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  recruiter: "Recruiter",
  viewer: "Viewer",
} as const

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Home, isActive: (path: string) => path === "/" },
  { href: "/watched", label: "Watched Repos", icon: Eye, isActive: (path: string) => path === "/watched" },
  { href: "/ecosystems", label: "Projects", icon: Layers, isActive: (path: string) => path.startsWith("/ecosystems") },
  { href: "/pipeline", label: "Pipeline", icon: CircleDot, isActive: (path: string) => path.startsWith("/pipeline") },
  { href: "/settings", label: "Settings", icon: Settings, isActive: (path: string) => path === "/settings" },
] as const

type HealthStatus = "ok" | "warn" | "error" | null

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

type ActivityEvent = {
  id: string
  type: string
  title: string
  description: string | null
  href: string
  createdAt: string
}

const RECENTLY_VIEWED_META = {
  contributor: { label: "Contributor", icon: Users },
  project: { label: "Project", icon: FolderKanban },
  scrape: { label: "Scrape", icon: Database },
  watched_repo: { label: "Watched repo", icon: Eye },
} as const

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

const HEADER_ICON_TRIGGER_CLASS =
  "hidden h-9 w-9 items-center justify-center rounded-md border border-transparent text-muted-foreground transition hover:border-border hover:bg-muted hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:border-border data-[state=open]:bg-muted data-[state=open]:text-foreground lg:inline-flex"

const GENESIS_TICKER_SEGMENT = [
  "00000000  04 ff ff 00 1d 01 04 45",
  "00000010  54 68 65 20 54 69 6d 65",
  "00000020  The Times 03/Jan/2009 Chancellor on brink of second bailout for banks",
  "00000030  6d 65 72 6b 6c 65 72 6f",
  "00000040  6f 74 20 7c 20 6e 6f 64 65",
]

function formatActivityTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value))
}

function getActivityIcon(type: string) {
  if (type === "scrape.completed") return CheckCircle2
  if (type === "project.created") return FolderKanban
  if (type === "watched_repo.added" || type === "watched_repo.contributors_found") return Eye
  if (type === "scrape.started") return Rocket
  return CircleDot
}

function TalonMark() {
  return (
    <Link href="/" className="flex min-h-11 min-w-0 shrink-0 items-center" aria-label="Talon home">
      <Image
        src="/talon-header-logo.png"
        alt="Talon"
        width={320}
        height={116}
        priority
        unoptimized
        className="h-10 w-auto shrink-0 object-contain md:h-11"
      />
    </Link>
  )
}

function GenesisTicker() {
  const tickerContent = (
    <span className="genesis-ticker-sequence">
      {GENESIS_TICKER_SEGMENT.map((item, index) => (
        <span
          key={`${item}-${index}`}
          className={index === 2 ? "genesis-ticker-highlight" : undefined}
        >
          {item}
        </span>
      ))}
    </span>
  )

  return (
    <div className="genesis-ticker" aria-label="Bitcoin Genesis Block homage">
      <div className="genesis-ticker-track">
        {tickerContent}
        {tickerContent}
        {tickerContent}
      </div>
    </div>
  )
}

function getIdentityLabel(me: AuthMe | null) {
  if (!me) return "Checking session..."
  if (me.actor === "admin") return "Admin access"
  return me.displayName || getEmailFallback(me.email)
}

function getEmailFallback(email: string) {
  return email.split("@")[0] || email
}

function getInitials(me: AuthMe | null, identityLabel: string) {
  if (me?.actor === "admin") return "A"
  const source = me?.actor === "user" ? me.displayName || me.email : identityLabel
  const [first = "", second = ""] = source
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
  return `${first[0] ?? "U"}${second[0] ?? ""}`.toUpperCase()
}

function AccountAvatar({
  me,
  identityLabel,
  className,
}: {
  me: AuthMe | null
  identityLabel: string
  className?: string
}) {
  const avatarUrl = me?.actor === "user" ? me.avatarUrl : null

  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/30 bg-primary/10 text-xs font-extrabold text-primary",
        className
      )}
      aria-hidden="true"
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : me?.actor === "admin" ? (
        <Shield className="h-4 w-4" />
      ) : (
        getInitials(me, identityLabel)
      )}
    </span>
  )
}

export function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const me = useAuthMe()
  const [signingOut, setSigningOut] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [healthStatus, setHealthStatus] = useState<HealthStatus>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)
  const [displayNameInput, setDisplayNameInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchGroups, setSearchGroups] = useState<SearchGroups>(EMPTY_SEARCH_GROUPS)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)
  const [recentOpen, setRecentOpen] = useState(false)
  const [recentItems, setRecentItems] = useState<RecentlyViewedItem[]>([])
  const searchRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activityOpenedByPointerRef = useRef(false)
  const recentOpenedByPointerRef = useRef(false)

  const canAdmin = me?.permissions.canAdmin ?? false
  const canWrite = me?.permissions.canWrite ?? false
  const recentScope = getRecentlyViewedScope(me)

  useEffect(() => {
    if (!canAdmin) {
      setHealthStatus(null)
      return
    }

    let cancelled = false

    async function loadHealthStatus() {
      try {
        const response = await fetch("/api/health", { cache: "no-store" })
        const data = await response.json().catch(() => null)
        if (cancelled) return
        if (!response.ok) {
          setHealthStatus("warn")
          return
        }
        setHealthStatus(data?.status === "warn" || data?.status === "error" ? data.status : "ok")
      } catch {
        if (!cancelled) setHealthStatus("error")
      }
    }

    loadHealthStatus()
    const interval = window.setInterval(loadHealthStatus, 60000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [canAdmin])

  useEffect(() => {
    if (me?.actor === "user") {
      setDisplayNameInput(me.displayName || getEmailFallback(me.email))
    }
  }, [me])

  useEffect(() => {
    function loadRecentItems() {
      setRecentItems(getRecentlyViewedItems(recentScope))
    }

    loadRecentItems()
    window.addEventListener(RECENTLY_VIEWED_EVENT, loadRecentItems)
    window.addEventListener("storage", loadRecentItems)
    return () => {
      window.removeEventListener(RECENTLY_VIEWED_EVENT, loadRecentItems)
      window.removeEventListener("storage", loadRecentItems)
    }
  }, [recentScope])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!searchRef.current?.contains(event.target as Node)) {
        setSearchOpen(false)
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [])

  useEffect(() => {
    const query = searchQuery.trim()
    if (!me || query.length < 2) {
      setSearchGroups(EMPTY_SEARCH_GROUPS)
      setSearchLoading(false)
      setSearchError(null)
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(async () => {
      setSearchLoading(true)
      setSearchError(null)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          cache: "no-store",
          signal: controller.signal,
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.error || "Search failed")
        setSearchGroups({
          contributors: data?.groups?.contributors ?? [],
          scrapes: data?.groups?.scrapes ?? [],
          projects: data?.groups?.projects ?? [],
          watchedRepos: data?.groups?.watchedRepos ?? [],
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        setSearchGroups(EMPTY_SEARCH_GROUPS)
        setSearchError("Search is unavailable right now.")
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false)
      }
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [me, searchQuery])

  useEffect(() => {
    if (!activityOpen || !me) return
    const controller = new AbortController()

    async function loadActivity() {
      setActivityLoading(true)
      setActivityError(null)
      try {
        const response = await fetch("/api/activity-events?limit=10", {
          cache: "no-store",
          signal: controller.signal,
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.error || "Activity could not load")
        setActivityEvents(Array.isArray(data?.events) ? data.events : [])
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        setActivityError("Activity is unavailable right now.")
      } finally {
        if (!controller.signal.aborted) setActivityLoading(false)
      }
    }

    loadActivity()
    return () => controller.abort()
  }, [activityOpen, me])

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } finally {
      router.push("/login")
      router.refresh()
    }
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return

    setProfileBusy(true)
    setProfileError(null)
    setProfileSaved(false)
    try {
      const formData = new FormData()
      formData.append("photo", file)
      const response = await fetch("/api/profile/photo", {
        method: "POST",
        body: formData,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Failed to upload profile photo")
      window.dispatchEvent(new Event(AUTH_ME_REFRESH_EVENT))
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Failed to upload profile photo")
    } finally {
      setProfileBusy(false)
    }
  }

  async function handleRemovePhoto() {
    setProfileBusy(true)
    setProfileError(null)
    setProfileSaved(false)
    try {
      const response = await fetch("/api/profile/photo", { method: "DELETE" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Failed to remove profile photo")
      window.dispatchEvent(new Event(AUTH_ME_REFRESH_EVENT))
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Failed to remove profile photo")
    } finally {
      setProfileBusy(false)
    }
  }

  async function handleDisplayNameSave() {
    if (me?.actor !== "user") return
    const nextDisplayName = displayNameInput.trim().replace(/\s+/g, " ")
    if (!nextDisplayName) {
      setProfileError("Display name is required.")
      return
    }

    setProfileBusy(true)
    setProfileError(null)
    setProfileSaved(false)
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: nextDisplayName }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Failed to update display name")
      setDisplayNameInput(data?.displayName || nextDisplayName)
      window.dispatchEvent(new Event(AUTH_ME_REFRESH_EVENT))
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Failed to update display name")
    } finally {
      setProfileBusy(false)
    }
  }

  function getSearchResultCount() {
    return SEARCH_GROUP_META.reduce((count, group) => count + searchGroups[group.key].length, 0)
  }

  function handleSearchNavigate(href: string) {
    setSearchOpen(false)
    setSearchQuery("")
    setSearchGroups(EMPTY_SEARCH_GROUPS)
    router.push(href)
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSearchOpen(false)
      return
    }
    if (event.key !== "Enter") return
    const firstResult = SEARCH_GROUP_META.flatMap((group) => searchGroups[group.key])[0]
    if (!firstResult) return
    event.preventDefault()
    handleSearchNavigate(firstResult.href)
  }

  const roleLabel = me ? (me.actor === "user" ? ROLE_LABELS[me.role] : "Break-glass admin") : null
  const identityLabel = getIdentityLabel(me)
  const secondaryIdentityLabel = !me
    ? "Loading current access"
    : me.actor === "user"
      ? me.email
      : "Full emergency access"
  const canEditProfilePhoto = me?.actor === "user"
  const displayNameChanged =
    me?.actor === "user" &&
    displayNameInput.trim().replace(/\s+/g, " ") !== (me.displayName || getEmailFallback(me.email))
  const trimmedSearchQuery = searchQuery.trim()
  const searchResultCount = getSearchResultCount()

  function renderAccountMenu(trigger: ReactNode, align: "start" | "end" = "end") {
    return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-72 rounded-lg border-border bg-popover shadow-none">
        <DropdownMenuLabel className="flex min-w-0 items-center gap-3">
          <AccountAvatar me={me} identityLabel={identityLabel} className="h-10 w-10" />
          <span className="min-w-0 space-y-1">
            <span className="block truncate text-sm font-bold">{identityLabel}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">{secondaryIdentityLabel}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
          <UserCircle className="mr-2 h-4 w-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} disabled={signingOut} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          {signingOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    )
  }

  function renderQuickActions() {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            className="hidden gap-2 lg:inline-flex"
            disabled={!canWrite}
          >
            <Plus className="h-4 w-4" />
            New
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56 rounded-lg border-border bg-popover shadow-none"
        >
          <DropdownMenuLabel className="text-xs font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
            Quick actions
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/?action=start-scrape">
              <Rocket className="mr-2 h-4 w-4" />
              Start Scrape
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/watched?action=add">
              <Eye className="mr-2 h-4 w-4" />
              Add Watched Repo
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/ecosystems?action=create">
              <FolderKanban className="mr-2 h-4 w-4" />
              Create Project
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function renderActivityMenu() {
    return (
      <DropdownMenu open={activityOpen} onOpenChange={setActivityOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn("relative", HEADER_ICON_TRIGGER_CLASS)}
            disabled={!me}
            aria-label="Open recent activity"
            onPointerDown={() => {
              activityOpenedByPointerRef.current = true
            }}
            onKeyDown={() => {
              activityOpenedByPointerRef.current = false
            }}
          >
            <Bell className="h-4 w-4" />
            {activityEvents.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (!activityOpenedByPointerRef.current) return
            event.preventDefault()
            activityOpenedByPointerRef.current = false
          }}
          className="w-96 rounded-lg border-border bg-popover p-2 shadow-none"
        >
          <DropdownMenuLabel className="flex items-center justify-between px-3 py-2">
            <span className="text-sm font-extrabold text-foreground">Recent activity</span>
            {activityLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {activityError ? (
            <div className="px-3 py-5 text-sm font-semibold text-rose-600">{activityError}</div>
          ) : activityLoading && activityEvents.length === 0 ? (
            <div className="flex items-center gap-3 px-3 py-5 text-sm font-semibold text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Loading activity...
            </div>
          ) : activityEvents.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm font-semibold text-muted-foreground">
              No recent activity yet.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto py-1">
              {activityEvents.map((event) => {
                const Icon = getActivityIcon(event.type)
                return (
                  <DropdownMenuItem
                    key={event.id}
                    onSelect={() => router.push(event.href)}
                    className="cursor-pointer rounded-lg p-3 focus:bg-primary/10"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center justify-between gap-3">
                        <span className="truncate text-sm font-extrabold text-foreground">{event.title}</span>
                        <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                          {formatActivityTime(event.createdAt)}
                        </span>
                      </span>
                      {event.description && (
                        <span className="mt-0.5 block truncate text-xs font-semibold text-muted-foreground">
                          {event.description}
                        </span>
                      )}
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function renderRecentlyViewedMenu() {
    return (
      <DropdownMenu open={recentOpen} onOpenChange={setRecentOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={HEADER_ICON_TRIGGER_CLASS}
            disabled={!me}
            aria-label="Open recently viewed"
            onPointerDown={() => {
              recentOpenedByPointerRef.current = true
            }}
            onKeyDown={() => {
              recentOpenedByPointerRef.current = false
            }}
          >
            <Clock className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (!recentOpenedByPointerRef.current) return
            event.preventDefault()
            recentOpenedByPointerRef.current = false
          }}
          className="w-96 rounded-lg border-border bg-popover p-2 shadow-none"
        >
          <DropdownMenuLabel className="px-3 py-2 text-sm font-extrabold text-foreground">
            Recently viewed
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {recentItems.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm font-semibold text-muted-foreground">
              No recent items yet.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto py-1">
              {recentItems.map((item) => {
                const meta = RECENTLY_VIEWED_META[item.type]
                const Icon = meta.icon
                return (
                  <DropdownMenuItem
                    key={`${item.type}-${item.id}`}
                    onSelect={() => router.push(item.href)}
                    className="cursor-pointer rounded-lg p-3 focus:bg-primary/10"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center justify-between gap-3">
                        <span className="truncate text-sm font-extrabold text-foreground">{item.title}</span>
                        <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
                          {formatActivityTime(item.viewedAt)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs font-semibold text-muted-foreground">
                        {item.subtitle ?? meta.label}
                      </span>
                    </span>
                  </DropdownMenuItem>
                )
              })}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const headerAccountTrigger = (
    <Button variant="outline" size="sm" className="max-w-64 justify-start gap-2" disabled={!me}>
      <AccountAvatar me={me} identityLabel={identityLabel} className="h-5 w-5 text-[10px]" />
      <span className="min-w-0 truncate text-left">{identityLabel}</span>
      {roleLabel && (
        <Badge variant="secondary" className="ml-1 hidden shrink-0 text-[10px] sm:inline-flex">
          {roleLabel}
        </Badge>
      )}
    </Button>
  )

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border bg-[#0a0e14]/90 backdrop-blur-md">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setMobileOpen((open) => !open)}
              aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
            <TalonMark />
          </div>
          <div ref={searchRef} className="relative hidden flex-1 justify-center lg:flex">
            <div className="relative w-full max-w-xl">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value)
                  setSearchOpen(true)
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search contributors, repos, projects..."
                className="h-10 rounded-md pl-10 pr-10 font-mono text-sm placeholder:text-muted-foreground/70 focus-visible:ring-primary/20"
              />
              {searchLoading && (
                <Loader2 className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary" />
              )}
              {searchOpen && trimmedSearchQuery.length > 0 && (
                <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-lg border border-border bg-popover shadow-none">
                  {trimmedSearchQuery.length < 2 ? (
                    <div className="px-4 py-5 text-sm font-semibold text-muted-foreground">
                      Type at least 2 characters to search Talon.
                    </div>
                  ) : searchError ? (
                    <div className="px-4 py-5 text-sm font-semibold text-rose-600">{searchError}</div>
                  ) : searchLoading && searchResultCount === 0 ? (
                    <div className="flex items-center gap-3 px-4 py-5 text-sm font-semibold text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      Searching...
                    </div>
                  ) : searchResultCount === 0 ? (
                    <div className="px-4 py-5 text-sm font-semibold text-muted-foreground">
                      No results found for &quot;{trimmedSearchQuery}&quot;.
                    </div>
                  ) : (
                    <div className="max-h-[28rem] overflow-y-auto py-2">
                      {SEARCH_GROUP_META.map((group) => {
                        const results = searchGroups[group.key]
                        if (results.length === 0) return null
                        const Icon = group.icon
                        return (
                          <div key={group.key} className="py-2">
                            <div className="flex items-center gap-2 px-4 pb-2 text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted-foreground">
                              <Icon className="h-3.5 w-3.5" />
                              {group.label}
                            </div>
                            <div className="space-y-1 px-2">
                              {results.map((result) => (
                                <button
                                  key={`${group.key}-${result.id}`}
                                  type="button"
                                  onClick={() => handleSearchNavigate(result.href)}
                                  className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-primary/10 focus:bg-primary/10 focus:outline-none"
                                >
                                  <span className="min-w-0">
                                    <span className="block truncate text-sm font-extrabold text-foreground">
                                      {result.title}
                                    </span>
                                    {result.subtitle && (
                                      <span className="mt-0.5 block truncate text-xs font-semibold text-muted-foreground">
                                        {result.subtitle}
                                      </span>
                                    )}
                                  </span>
                                  <span className="shrink-0 rounded-md border border-primary/25 bg-primary/10 px-2 py-1 font-mono text-[10px] font-bold text-primary">
                                    Open
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canAdmin && healthStatus && healthStatus !== "ok" && (
              <Link
                href="/settings"
                className="hidden items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 font-mono text-xs font-bold text-amber-300 transition-colors hover:bg-amber-500/15 sm:inline-flex"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Ops attention
              </Link>
            )}
            {renderQuickActions()}
            {renderRecentlyViewedMenu()}
            {renderActivityMenu()}
            {renderAccountMenu(headerAccountTrigger)}
          </div>
        </div>
        {mobileOpen && (
          <nav className="grid gap-1 border-t border-border bg-[#0a0e14] p-3 lg:hidden">
            {canAdmin && healthStatus && healthStatus !== "ok" && (
              <Link
                href="/settings"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-bold text-amber-300"
              >
                <AlertTriangle className="h-4 w-4" />
                Ops attention
              </Link>
            )}
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const active = item.isActive(pathname)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition-all",
                    active ? "border border-primary/30 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        )}
      </header>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="rounded-lg border-border bg-card shadow-none sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Profile</DialogTitle>
            <DialogDescription>Manage the account identity shown inside Talon.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="flex items-center gap-4 rounded-lg border border-border bg-muted p-4">
              <AccountAvatar me={me} identityLabel={identityLabel} className="h-20 w-20 text-xl ring-2 ring-white" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-extrabold text-foreground">{identityLabel}</p>
                <p className="truncate text-sm font-semibold text-muted-foreground">{secondaryIdentityLabel}</p>
                {roleLabel && (
                  <Badge variant="secondary" className="mt-2">
                    {roleLabel}
                  </Badge>
                )}
              </div>
            </div>

            {profileError && (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {profileError}
              </div>
            )}

            {profileSaved && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                Profile saved.
              </div>
            )}

            {canEditProfilePhoto ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="profile-display-name">Display name</Label>
                  <div className="flex gap-2">
                    <Input
                      id="profile-display-name"
                      value={displayNameInput}
                      onChange={(event) => setDisplayNameInput(event.target.value)}
                      maxLength={120}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={profileBusy || !displayNameInput.trim() || !displayNameChanged}
                      onClick={handleDisplayNameSave}
                      className="bg-background"
                    >
                      Save
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={handlePhotoChange}
                  />
                  <Button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={profileBusy}
                    className="w-full"
                  >
                    <Camera className="h-4 w-4" />
                    {profileBusy ? "Working..." : "Upload photo"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={profileBusy || me?.actor !== "user" || !me.avatarUrl}
                    onClick={handleRemovePhoto}
                    className="w-full text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove photo
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-3 text-sm font-semibold text-muted-foreground">
                Profile photos are available for team user accounts.
              </div>
            )}

            <p className="text-xs font-medium leading-relaxed text-muted-foreground">
              Use a square JPEG, PNG, or WebP image. Talon accepts files up to 2MB.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <aside className="fixed left-0 top-16 z-40 hidden h-[calc(100vh-4rem)] w-72 border-r border-border bg-[#0a0e14] p-4 lg:flex lg:flex-col">
        <div className="mb-5 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-extrabold text-foreground">Default workspace</p>
              <p className="text-xs font-semibold text-muted-foreground">Recruiting operations</p>
            </div>
          </div>
        </div>
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = item.isActive(pathname)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold transition-all duration-200",
                  active
                    ? "border border-primary/30 bg-primary/10 text-primary"
                    : "text-muted-foreground hover:translate-x-1 hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto">
          {pathname === "/" && <GenesisTicker />}
          {renderAccountMenu(
            <button
              type="button"
              disabled={!me}
              className="group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-primary/30 hover:bg-muted disabled:pointer-events-none disabled:opacity-70"
              aria-label="Open account menu"
            >
              <AccountAvatar me={me} identityLabel={identityLabel} className="h-11 w-11" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-extrabold text-foreground">{identityLabel}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  {roleLabel && (
                    <Badge variant="secondary" className="text-[10px]">
                      {roleLabel}
                    </Badge>
                  )}
                </span>
              </span>
              <Settings className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
            </button>,
            "start"
          )}
        </div>
      </aside>
    </>
  )
}
