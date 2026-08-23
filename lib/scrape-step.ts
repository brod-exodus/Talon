export const SCRAPE_HYDRATION_BATCH_SIZE = 20
export const CONTRIBUTOR_PROFILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const GITHUB_REQUESTS_PER_COLD_PROFILE = 2
export const MAX_GITHUB_REQUESTS_PER_SCRAPE_STEP =
  SCRAPE_HYDRATION_BATCH_SIZE * GITHUB_REQUESTS_PER_COLD_PROFILE

export type ScrapeCandidate = {
  login: string
  contributions: number
}

export function estimateScrapeStepGitHubRequests(job: {
  state?: unknown
}): number {
  const state = job.state && typeof job.state === "object" && !Array.isArray(job.state)
    ? job.state as { phase?: unknown }
    : {}
  return state.phase === "hydrate"
    ? MAX_GITHUB_REQUESTS_PER_SCRAPE_STEP
    : 1
}

export function contributorProfileFreshAfter(now = Date.now()): string {
  return new Date(now - CONTRIBUTOR_PROFILE_CACHE_TTL_MS).toISOString()
}

export function splitHydrationBatchByProfileCache(
  batch: ScrapeCandidate[],
  freshUsernames: ReadonlySet<string>
): { cached: ScrapeCandidate[]; refresh: ScrapeCandidate[] } {
  const cached: ScrapeCandidate[] = []
  const refresh: ScrapeCandidate[] = []
  for (const candidate of batch) {
    if (freshUsernames.has(candidate.login)) cached.push(candidate)
    else refresh.push(candidate)
  }
  return { cached, refresh }
}

export function planHydrationStep(
  candidates: ScrapeCandidate[],
  alreadyLinked: ReadonlySet<string>,
  batchSize = SCRAPE_HYDRATION_BATCH_SIZE
) {
  const remaining = candidates.filter((candidate) => !alreadyLinked.has(candidate.login))
  const batch = remaining.slice(0, Math.max(1, Math.floor(batchSize)))

  return {
    batch,
    processedAfterStep: candidates.length - remaining.length + batch.length,
    completesHydration: remaining.length <= batch.length,
  }
}

export function planOrganizationDiscoveryStep(repoCount: number, repoIndex: number) {
  const safeCount = Math.max(0, Math.floor(repoCount))
  const safeIndex = Math.max(0, Math.floor(repoIndex))

  return {
    repoIndex: safeIndex,
    hasRepository: safeIndex < safeCount,
    completesDiscovery: safeIndex + 1 >= safeCount,
    nextRepoIndex: Math.min(safeIndex + 1, safeCount),
  }
}

export function planOrganizationRepositoryPage(page: number, hasNext: boolean) {
  const scannedPage = Math.max(1, Math.floor(page))
  return {
    scannedPage,
    nextPage: scannedPage + 1,
    completesDiscovery: !hasNext,
  }
}

export function planRepositoryContributorPage(page: number, hasNext: boolean) {
  const scannedPage = Math.max(1, Math.floor(page))
  return {
    scannedPage,
    nextPage: scannedPage + 1,
    completesDiscovery: !hasNext,
  }
}
