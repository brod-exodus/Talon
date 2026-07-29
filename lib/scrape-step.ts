export const SCRAPE_HYDRATION_BATCH_SIZE = 10

export type ScrapeCandidate = {
  login: string
  contributions: number
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
