"use client"

import { type AuthMe } from "@/lib/client-permissions"

export const RECENTLY_VIEWED_EVENT = "talon-recently-viewed-updated"

export type RecentlyViewedType = "contributor" | "project" | "scrape" | "watched_repo"

export type RecentlyViewedItem = {
  type: RecentlyViewedType
  id: string
  title: string
  subtitle?: string
  href: string
  viewedAt: string
}

const MAX_RECENT_ITEMS = 10

export function getRecentlyViewedScope(me: AuthMe | null): string | null {
  if (!me) return null
  if (me.actor === "admin") return "admin:default"
  return `user:${me.teamSlug}:${me.email.toLowerCase()}`
}

function storageKey(scope: string): string {
  return `talon:recently-viewed:v1:${scope}`
}

export function getRecentlyViewedItems(scope: string | null): RecentlyViewedItem[] {
  if (!scope || typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(storageKey(scope))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is RecentlyViewedItem =>
        item &&
        typeof item === "object" &&
        typeof item.type === "string" &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        typeof item.href === "string" &&
        typeof item.viewedAt === "string"
      )
      .slice(0, MAX_RECENT_ITEMS)
  } catch {
    return []
  }
}

export function recordRecentlyViewed(
  scope: string | null,
  item: Omit<RecentlyViewedItem, "viewedAt">
): void {
  if (!scope || typeof window === "undefined") return
  const viewedAt = new Date().toISOString()
  const nextItem = { ...item, viewedAt }
  const existing = getRecentlyViewedItems(scope).filter(
    (recent) => !(recent.type === item.type && recent.id === item.id)
  )
  const next = [nextItem, ...existing].slice(0, MAX_RECENT_ITEMS)
  window.localStorage.setItem(storageKey(scope), JSON.stringify(next))
  window.dispatchEvent(new Event(RECENTLY_VIEWED_EVENT))
}
