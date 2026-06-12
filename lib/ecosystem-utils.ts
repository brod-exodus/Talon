export type EcosystemAggregateContributor = {
  id: string
  github_username: string
  name: string | null
  avatar_url: string | null
  email: string | null
  twitter: string | null
  linkedin: string | null
  website: string | null
  talon_score?: number | null
}

export type EcosystemAggregateLink = {
  contributor_id: string
  scrape_id: string
  contributions: number
}

export type EcosystemAggregateOutput = {
  id: string
  username: string
  name: string
  avatar: string
  score: number | null
  scrapeCount: number
  scrapeTargets: string[]
  totalContributions: number
  contacts: { email?: string; twitter?: string; linkedin?: string; website?: string }
}

/** True when cached project contributor rows predate Talon Score (no score key). */
export function ecosystemCacheRowsMissingScore(rows: Array<Record<string, unknown>>): boolean {
  return rows.length > 0 && !("score" in rows[0])
}

export type EcosystemContributorCacheFreshnessInput = {
  cachedScrapeIds: string[]
  currentScrapeIds: string[]
  cachedContributorCount: number
  totalScrapeContributors: number
  recomputedAt: string | null
  latestScrapeCompletedAt: string | null
  nowMs?: number
}

const EMPTY_CACHE_REPAIR_COOLDOWN_MS = 60_000

function hasContactValue(value: string | null | undefined): boolean {
  return value != null && value.trim() !== ""
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((item) => rightSet.has(item))
}

export function shouldRecomputeEcosystemContributorCache({
  cachedScrapeIds,
  currentScrapeIds,
  cachedContributorCount,
  totalScrapeContributors,
  recomputedAt,
  latestScrapeCompletedAt,
  nowMs = Date.now(),
}: EcosystemContributorCacheFreshnessInput): boolean {
  if (!sameStringSet(cachedScrapeIds, currentScrapeIds)) return true

  if (cachedContributorCount > 0 || totalScrapeContributors <= 0 || currentScrapeIds.length === 0) return false

  const recomputedMs = recomputedAt ? Date.parse(recomputedAt) : Number.NaN
  if (!Number.isFinite(recomputedMs)) return true

  const latestCompletedMs = latestScrapeCompletedAt ? Date.parse(latestScrapeCompletedAt) : Number.NaN
  if (Number.isFinite(latestCompletedMs) && recomputedMs < latestCompletedMs) return true

  return nowMs - recomputedMs > EMPTY_CACHE_REPAIR_COOLDOWN_MS
}

export function aggregateEcosystemContributors(
  contributors: EcosystemAggregateContributor[],
  links: EcosystemAggregateLink[],
  targetMap: Map<string, string>
): EcosystemAggregateOutput[] {
  const aggMap = new Map<string, { scrapeIdSet: Set<string>; totalContributions: number }>()

  for (const link of links) {
    const agg = aggMap.get(link.contributor_id) ?? {
      scrapeIdSet: new Set<string>(),
      totalContributions: 0,
    }
    agg.scrapeIdSet.add(link.scrape_id)
    agg.totalContributions += link.contributions
    aggMap.set(link.contributor_id, agg)
  }

  const aggregated: EcosystemAggregateOutput[] = []

  for (const contributor of contributors) {
    if (![contributor.email, contributor.twitter, contributor.linkedin, contributor.website].some(hasContactValue)) {
      continue
    }

    const agg = aggMap.get(contributor.id)
    if (!agg) continue

    aggregated.push({
      id: contributor.id,
      username: contributor.github_username,
      name: contributor.name ?? contributor.github_username,
      avatar: contributor.avatar_url ?? "",
      score: contributor.talon_score ?? null,
      scrapeCount: agg.scrapeIdSet.size,
      scrapeTargets: Array.from(agg.scrapeIdSet).map((scrapeId) => targetMap.get(scrapeId) ?? scrapeId),
      totalContributions: agg.totalContributions,
      contacts: {
        email: contributor.email ?? undefined,
        twitter: contributor.twitter ?? undefined,
        linkedin: contributor.linkedin ?? undefined,
        website: contributor.website ?? undefined,
      },
    })
  }

  return aggregated.sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) ||
      b.scrapeCount - a.scrapeCount ||
      b.totalContributions - a.totalContributions
  )
}
