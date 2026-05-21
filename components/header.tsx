"use client"

import Link from "next/link"
import Image from "next/image"
import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { AlertTriangle, Eye, Home, Layers, LogOut, Menu, Settings, Shield, Sparkles, UserCircle, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuthMe } from "@/lib/client-permissions"
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

export function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const me = useAuthMe()
  const [signingOut, setSigningOut] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [healthStatus, setHealthStatus] = useState<HealthStatus>(null)

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

  const roleLabel = me ? (me.actor === "user" ? ROLE_LABELS[me.role] : "Break-glass admin") : null
  const identityLabel = me ? (me.actor === "user" ? me.email : "Admin access") : "Checking session..."

  const accountMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-64 justify-start gap-2 bg-white/75">
          {me?.actor === "admin" ? (
            <Shield className="h-4 w-4 shrink-0 text-primary" />
          ) : (
            <UserCircle className="h-4 w-4 shrink-0 text-primary" />
          )}
          <span className="min-w-0 truncate text-left">{identityLabel}</span>
          {roleLabel && (
            <Badge variant="secondary" className="ml-1 hidden shrink-0 text-[10px] sm:inline-flex">
              {roleLabel}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-2xl border-white/70 bg-white/95 shadow-xl shadow-indigo-500/10 backdrop-blur-xl">
        <DropdownMenuLabel className="space-y-1">
          <span className="block truncate text-sm font-bold">{identityLabel}</span>
          <span className="block text-xs font-normal text-muted-foreground">
            {!me
              ? "Loading current access"
              : me.actor === "user"
                ? `Team ${me.teamSlug} · ${roleLabel}`
                : "Full emergency access"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut} disabled={signingOut} className="text-destructive focus:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          {signingOut ? "Signing out..." : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
            {accountMenu}
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
        <div className="mt-auto rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-xs text-muted-foreground">
          <p className="font-extrabold text-primary">Prism Glass</p>
          <p className="mt-1 leading-relaxed">Lightweight surfaces for focused contributor discovery.</p>
        </div>
      </aside>
    </>
  )
}
