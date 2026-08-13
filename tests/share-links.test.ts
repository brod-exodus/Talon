import test from "node:test"
import assert from "node:assert/strict"
import {
  getShareAvailability,
  normalizeShareExpiryDays,
  shareExpiresAt,
  shareTokenHash,
  toPublicSharedScrape,
} from "../lib/share-links.ts"
import type { AppScrape } from "../lib/db.ts"

test("share expiry accepts only the supported bounded choices", () => {
  assert.equal(normalizeShareExpiryDays(1), 1)
  assert.equal(normalizeShareExpiryDays("7"), 7)
  assert.equal(normalizeShareExpiryDays(30), 30)
  assert.equal(normalizeShareExpiryDays(0), null)
  assert.equal(normalizeShareExpiryDays(365), null)
  assert.equal(normalizeShareExpiryDays(true), null)
})

test("share tokens are stored as deterministic SHA-256 hashes", () => {
  const hash = shareTokenHash("public-bearer-token-value")
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.equal(hash, shareTokenHash("public-bearer-token-value"))
  assert.notEqual(hash, "public-bearer-token-value")
})

test("share availability gives revocation precedence over expiry", () => {
  const now = new Date("2026-08-13T12:00:00Z")
  assert.equal(getShareAvailability({ expiresAt: "2026-08-14T12:00:00Z", revokedAt: null }, now), "active")
  assert.equal(getShareAvailability({ expiresAt: "2026-08-12T12:00:00Z", revokedAt: null }, now), "expired")
  assert.equal(
    getShareAvailability({ expiresAt: "2026-08-12T12:00:00Z", revokedAt: "2026-08-11T12:00:00Z" }, now),
    "revoked"
  )
  assert.equal(shareExpiresAt(7, now), "2026-08-20T12:00:00.000Z")
})

test("public share serialization removes recruiter-only contributor state", () => {
  const scrape = {
    id: "scrape-123456",
    type: "repository",
    target: "octocat/Hello-World",
    status: "completed",
    progress: 100,
    current: 1,
    total: 1,
    startedAt: "2026-08-13T10:00:00Z",
    completedAt: "2026-08-13T10:01:00Z",
    error: "internal error should not escape",
    contributors: [{
      id: "contributor-1",
      username: "octocat",
      name: "The Octocat",
      avatar: "https://avatars.example/octocat.png",
      contributions: 5,
      bio: "Public bio",
      location: "Internet",
      company: "GitHub",
      contacts: { email: "public@example.com" },
      contacted: true,
      contactedDate: "2026-08-01",
      notes: "Private recruiter note",
      status: "interviewing",
    }],
  } as AppScrape

  const response = toPublicSharedScrape(scrape, {
    expiresAt: "2026-08-20T12:00:00Z",
    allowDownload: false,
  })
  const serialized = JSON.stringify(response)

  assert.equal(response.contributors[0]?.contacts.email, "public@example.com")
  assert.doesNotMatch(serialized, /Private recruiter note|contactedDate|interviewing|internal error/)
  assert.equal(response.share.allowDownload, false)
})
