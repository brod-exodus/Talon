import { createHash } from "node:crypto"
import type { AppScrape } from "@/lib/db"

export const SHARE_EXPIRY_OPTIONS_DAYS = [1, 7, 30] as const
export const DEFAULT_SHARE_EXPIRY_DAYS = 7

export type ShareAvailability = "active" | "expired" | "revoked"

export function normalizeShareExpiryDays(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null
  const days = typeof value === "number" ? value : Number(value)
  return SHARE_EXPIRY_OPTIONS_DAYS.includes(days as (typeof SHARE_EXPIRY_OPTIONS_DAYS)[number])
    ? days
    : null
}

export function shareExpiresAt(days: number, now = new Date()): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

export function shareTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function getShareAvailability(
  share: { expiresAt: string; revokedAt: string | null },
  now = new Date()
): ShareAvailability {
  if (share.revokedAt) return "revoked"
  return Date.parse(share.expiresAt) <= now.getTime() ? "expired" : "active"
}

/**
 * Public shares intentionally omit outreach state, recruiter notes, reminders,
 * internal progress/errors, and team identifiers.
 */
export function toPublicSharedScrape(
  scrape: AppScrape,
  share: { expiresAt: string; allowDownload: boolean }
) {
  return {
    id: scrape.id,
    type: scrape.type,
    target: scrape.target,
    completedAt: scrape.completedAt,
    contributors: (scrape.contributors ?? []).map((contributor) => ({
      id: contributor.id,
      username: contributor.username,
      name: contributor.name,
      avatar: contributor.avatar,
      contributions: contributor.contributions,
      bio: contributor.bio,
      location: contributor.location,
      company: contributor.company,
      contacts: contributor.contacts,
    })),
    share: {
      expiresAt: share.expiresAt,
      allowDownload: share.allowDownload,
    },
  }
}
