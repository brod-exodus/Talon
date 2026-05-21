"use client"

import Link from "next/link"
import Image from "next/image"
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AlertTriangle, Camera, Eye, Home, Layers, LogOut, Menu, Settings, Shield, Sparkles, Trash2, UserCircle, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AUTH_ME_REFRESH_EVENT, type AuthMe, useAuthMe } from "@/lib/client-permissions"
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
  { href: "/ecosystems", label: "Ecosystems", icon: Layers, isActive: (path: string) => path.startsWith("/ecosystems") },
  { href: "/settings", label: "Settings", icon: Settings, isActive: (path: string) => path === "/settings" },
] as const

type HealthStatus = "ok" | "warn" | "error" | null

function TalonMark() {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5">
      <Image src="/logos/talon-prism-mark.svg" alt="" width={34} height={34} className="h-9 w-9 shrink-0 object-contain" />
      <span className="min-w-0">
        <span className="block text-xl font-extrabold tracking-tight prism-text-gradient">Talon</span>
      </span>
    </Link>
  )
}

function getIdentityLabel(me: AuthMe | null) {
  if (!me) return "Checking session..."
  if (me.actor === "admin") return "Admin access"
  return me.displayName || me.email
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
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-50 text-xs font-extrabold text-primary ring-1 ring-indigo-100",
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canAdmin = me?.permissions.canAdmin ?? false

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
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Failed to upload profile photo")
    } finally {
      setProfileBusy(false)
    }
  }

  async function handleRemovePhoto() {
    setProfileBusy(true)
    setProfileError(null)
    try {
      const response = await fetch("/api/profile/photo", { method: "DELETE" })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Failed to remove profile photo")
      window.dispatchEvent(new Event(AUTH_ME_REFRESH_EVENT))
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Failed to remove profile photo")
    } finally {
      setProfileBusy(false)
    }
  }

  const roleLabel = me ? (me.actor === "user" ? ROLE_LABELS[me.role] : "Break-glass admin") : null
  const identityLabel = getIdentityLabel(me)
  const secondaryIdentityLabel = !me
    ? "Loading current access"
    : me.actor === "user"
      ? `${me.email} · Team ${me.teamSlug}`
      : "Full emergency access"
  const canEditProfilePhoto = me?.actor === "user"

  function renderAccountMenu(trigger: ReactNode, align: "start" | "end" = "end") {
    return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-72 rounded-2xl border-white/70 bg-white/95 shadow-xl shadow-indigo-500/10 backdrop-blur-xl">
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

  const headerAccountTrigger = (
    <Button variant="outline" size="sm" className="max-w-64 justify-start gap-2 bg-white/75" disabled={!me}>
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
      <header className="sticky top-0 z-50 border-b border-white/70 bg-white/80 shadow-lg shadow-indigo-500/5 backdrop-blur-xl">
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
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              const active = item.isActive(pathname)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-all",
                    active
                      ? "bg-indigo-50 text-primary shadow-sm shadow-indigo-500/10"
                      : "text-muted-foreground hover:bg-white/70 hover:text-primary"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
          <div className="flex items-center gap-2">
            {canAdmin && healthStatus && healthStatus !== "ok" && (
              <Link
                href="/settings"
                className="hidden items-center gap-2 rounded-full border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs font-bold text-amber-700 shadow-sm shadow-amber-500/10 transition-colors hover:bg-amber-100 sm:inline-flex"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Ops attention
              </Link>
            )}
            {renderAccountMenu(headerAccountTrigger)}
          </div>
        </div>
        {mobileOpen && (
          <nav className="grid gap-1 border-t border-white/70 bg-white/90 p-3 shadow-xl shadow-indigo-500/5 backdrop-blur-xl lg:hidden">
            {canAdmin && healthStatus && healthStatus !== "ok" && (
              <Link
                href="/settings"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm font-bold text-amber-700"
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
                    active ? "prism-gradient text-white shadow-lg shadow-indigo-500/20" : "text-muted-foreground hover:bg-white hover:text-primary"
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
        <DialogContent className="rounded-3xl border-white/70 bg-white/95 shadow-2xl shadow-indigo-500/15 backdrop-blur-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Profile</DialogTitle>
            <DialogDescription>Manage the account identity shown inside Talon.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="flex items-center gap-4 rounded-2xl border border-white/70 bg-white/70 p-4 shadow-sm shadow-indigo-500/5">
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

            {canEditProfilePhoto ? (
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
                  className="w-full bg-white/80 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove photo
                </Button>
              </div>
            ) : (
              <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-sm font-semibold text-muted-foreground">
                Profile photos are available for team user accounts.
              </div>
            )}

            <p className="text-xs font-medium leading-relaxed text-muted-foreground">
              Use a square JPEG, PNG, or WebP image. Talon accepts files up to 2MB.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <aside className="fixed left-0 top-16 z-40 hidden h-[calc(100vh-4rem)] w-72 border-r border-white/70 bg-white/55 p-4 shadow-xl shadow-indigo-500/5 backdrop-blur-xl lg:flex lg:flex-col">
        <div className="mb-5 rounded-2xl border border-white/70 bg-white/65 p-4 shadow-sm shadow-indigo-500/5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full prism-gradient text-white shadow-lg shadow-indigo-500/20">
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
                    ? "bg-white text-primary shadow-md shadow-indigo-500/10 ring-1 ring-white/80"
                    : "text-muted-foreground hover:translate-x-1 hover:bg-white/65 hover:text-primary"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="mt-auto">
          {renderAccountMenu(
            <button
              type="button"
              disabled={!me}
              className="group flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-2xl border border-white/70 bg-white/70 p-4 text-left shadow-md shadow-indigo-500/10 transition-all hover:bg-white hover:shadow-lg hover:shadow-indigo-500/15 disabled:pointer-events-none disabled:opacity-70"
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
                  {me?.actor === "user" && (
                    <span className="truncate text-xs font-semibold text-muted-foreground">Team {me.teamSlug}</span>
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
