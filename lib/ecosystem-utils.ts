export type EcosystemAggregateContributor = {
  id: string
  github_username: string
  name: string | null
  avatar_url: string | null
  email: string | null
  twitter: string | null
  linkedin: string | null
  website: string | null
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
  scrapeCount: number
  scrapeTargets: string[]
  totalContributions: number
  contacts: { email?: string; twitter?: string; linkedin?: string; website?: string }
}

function hasContactValue(value: string | null | undefined): boolean {
  return value != null && value.trim() !== ""
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

  return aggregated.sort((a, b) => b.scrapeCount - a.scrapeCount || b.totalContributions - a.totalContributions)
}
