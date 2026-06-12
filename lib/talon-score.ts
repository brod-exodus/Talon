// Talon Score: a 0-100 contributor signal computed from data Talon already
// collects. Pure module — no Supabase imports — so the formula is unit-testable
// and tunable without touching migrations. Inputs are gathered by the
// get_talon_score_inputs RPC (db/migrations/022_talon_score.sql).

export type TalonScoreContacts = {
  email?: string | null
  twitter?: string | null
  linkedin?: string | null
  website?: string | null
}

export type TalonScoreInputs = {
  totalContributions: number
  completedScrapeCount: number
  /** Contributions divided by the top contributor's count, for the contributor's best scrape (0..1). */
  bestShare: number
  /** Contributor pool size of that best scrape; damps the solo-repo "maintainer" artifact. */
  bestSharePool: number
  latestScrapeCompletedAt: string | null
  contacts: TalonScoreContacts
  nowMs?: number
}

export type TalonScoreBreakdown = {
  depth: number
  breadth: number
  influence: number
  recency: number
  contactability: number
  explanation: string
}

export type TalonScoreResult = {
  score: number
  breakdown: TalonScoreBreakdown
}

export const DEPTH_MAX_POINTS = 30
export const BREADTH_MAX_POINTS = 20
export const INFLUENCE_MAX_POINTS = 20
export const RECENCY_MAX_POINTS = 15
export const CONTACTABILITY_MAX_POINTS = 15

/** Contributions at which the depth component saturates. */
const DEPTH_FULL_CONTRIBUTIONS = 2000
/** Completed scrapes at which the breadth component saturates. */
const BREADTH_FULL_SCRAPES = 5
/** Influence only earns full weight when the best scrape has at least this many contributors. */
const INFLUENCE_FULL_POOL = 5
const RECENCY_FULL_DAYS = 30
const RECENCY_ZERO_DAYS = 365

const CONTACT_POINTS = { email: 9, linkedin: 4, twitter: 1, website: 1 } as const

const DAY_MS = 24 * 60 * 60 * 1000

function hasContactValue(value: string | null | undefined): boolean {
  return value != null && value.trim() !== ""
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatCount(value: number): string {
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

function depthPoints(totalContributions: number): number {
  if (totalContributions <= 0) return 0
  const ratio = Math.log10(1 + totalContributions) / Math.log10(1 + DEPTH_FULL_CONTRIBUTIONS)
  return DEPTH_MAX_POINTS * Math.min(1, ratio)
}

function breadthPoints(completedScrapeCount: number): number {
  if (completedScrapeCount <= 0) return 0
  return BREADTH_MAX_POINTS * Math.min(1, completedScrapeCount / BREADTH_FULL_SCRAPES)
}

function influencePoints(bestShare: number, bestSharePool: number): number {
  const share = clamp(bestShare, 0, 1)
  const poolDamp = clamp((bestSharePool - 1) / (INFLUENCE_FULL_POOL - 1), 0, 1)
  return INFLUENCE_MAX_POINTS * share * poolDamp
}

function daysSince(timestamp: string | null, nowMs: number): number | null {
  if (!timestamp) return null
  const parsedMs = Date.parse(timestamp)
  if (!Number.isFinite(parsedMs)) return null
  return Math.max(0, (nowMs - parsedMs) / DAY_MS)
}

function recencyPoints(days: number | null): number {
  if (days == null) return 0
  if (days <= RECENCY_FULL_DAYS) return RECENCY_MAX_POINTS
  if (days >= RECENCY_ZERO_DAYS) return 0
  const remaining = (RECENCY_ZERO_DAYS - days) / (RECENCY_ZERO_DAYS - RECENCY_FULL_DAYS)
  return RECENCY_MAX_POINTS * remaining
}

function contactabilityPoints(contacts: TalonScoreContacts): number {
  let points = 0
  if (hasContactValue(contacts.email)) points += CONTACT_POINTS.email
  if (hasContactValue(contacts.linkedin)) points += CONTACT_POINTS.linkedin
  if (hasContactValue(contacts.twitter)) points += CONTACT_POINTS.twitter
  if (hasContactValue(contacts.website)) points += CONTACT_POINTS.website
  return Math.min(CONTACTABILITY_MAX_POINTS, points)
}

function describeReachability(contacts: TalonScoreContacts): string | null {
  if (hasContactValue(contacts.email)) return "reachable by email"
  if (hasContactValue(contacts.linkedin)) return "reachable on LinkedIn"
  if (hasContactValue(contacts.twitter) || hasContactValue(contacts.website)) return "reachable online"
  return null
}

function buildExplanation(
  score: number,
  inputs: TalonScoreInputs,
  components: { influence: number },
  days: number | null
): string {
  const reachability = describeReachability(inputs.contacts)

  if (inputs.completedScrapeCount <= 0) {
    const suffix = reachability ? `; ${reachability}` : "; no contact info on file"
    return `${score}/100 — no completed scrape data yet${suffix}.`
  }

  const parts: string[] = []

  const contributionLabel = `${formatCount(inputs.totalContributions)} contribution${inputs.totalContributions === 1 ? "" : "s"}`
  if (inputs.totalContributions >= 500) {
    parts.push(`heavy contributor (${contributionLabel})`)
  } else if (inputs.totalContributions >= 50) {
    parts.push(`active contributor (${contributionLabel})`)
  } else {
    parts.push(`light contributor (${contributionLabel})`)
  }

  parts.push(`across ${inputs.completedScrapeCount} scrape${inputs.completedScrapeCount === 1 ? "" : "s"}`)

  if (components.influence >= INFLUENCE_MAX_POINTS * 0.75) {
    parts.push("top contributor in one repo")
  } else if (components.influence >= INFLUENCE_MAX_POINTS * 0.4) {
    parts.push("core contributor in one repo")
  }

  if (days != null) {
    parts.push(`seen in a scrape ${Math.round(days)}d ago`)
  }

  if (reachability) {
    parts.push(reachability)
  } else {
    parts.push("no contact info on file")
  }

  return `${score}/100 — ${parts.join(", ")}.`
}

export function computeTalonScore(inputs: TalonScoreInputs): TalonScoreResult {
  const nowMs = inputs.nowMs ?? Date.now()
  const days = daysSince(inputs.latestScrapeCompletedAt, nowMs)

  const depth = depthPoints(inputs.totalContributions)
  const breadth = breadthPoints(inputs.completedScrapeCount)
  const influence = influencePoints(inputs.bestShare, inputs.bestSharePool)
  const recency = recencyPoints(days)
  const contactability = contactabilityPoints(inputs.contacts)

  const score = clamp(Math.round(depth + breadth + influence + recency + contactability), 0, 100)

  return {
    score,
    breakdown: {
      depth: Math.round(depth),
      breadth: Math.round(breadth),
      influence: Math.round(influence),
      recency: Math.round(recency),
      contactability: Math.round(contactability),
      explanation: buildExplanation(score, inputs, { influence }, days),
    },
  }
}

export function shouldRecomputeTalonScore({
  score,
  computedAt,
  latestCompletedSourceAt,
}: {
  score: number | null
  computedAt: string | null
  latestCompletedSourceAt: string | null
}): boolean {
  if (score == null || computedAt == null) return true

  const computedMs = Date.parse(computedAt)
  if (!Number.isFinite(computedMs)) return true

  const latestMs = latestCompletedSourceAt ? Date.parse(latestCompletedSourceAt) : Number.NaN
  return Number.isFinite(latestMs) && computedMs < latestMs
}
