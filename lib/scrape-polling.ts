type ScrapeIdentity = {
  id: string
}

type ScrapePollSnapshot<TActive extends ScrapeIdentity, TTerminal extends ScrapeIdentity> = {
  active?: TActive[]
  completed?: TTerminal[]
  failed?: TTerminal[]
}

export function reconcileActiveScrapePoll<TActive extends ScrapeIdentity, TTerminal extends ScrapeIdentity>(
  previousActive: TActive[],
  snapshot: ScrapePollSnapshot<TActive, TTerminal>,
): {
  active: TActive[]
  didComplete: boolean
  retainedPrevious: boolean
} {
  const nextActive = Array.isArray(snapshot.active) ? snapshot.active : []
  if (previousActive.length === 0 || nextActive.length > 0) {
    return { active: nextActive, didComplete: false, retainedPrevious: false }
  }

  const completedIds = new Set((snapshot.completed ?? []).map((scrape) => scrape.id))
  const terminalIds = new Set([
    ...(snapshot.completed ?? []).map((scrape) => scrape.id),
    ...(snapshot.failed ?? []).map((scrape) => scrape.id),
  ])
  const previousIds = previousActive.map((scrape) => scrape.id)
  const allPreviousScrapesResolved = previousIds.every((id) => terminalIds.has(id))

  if (allPreviousScrapesResolved) {
    return {
      active: [],
      didComplete: previousIds.some((id) => completedIds.has(id)),
      retainedPrevious: false,
    }
  }

  return { active: previousActive, didComplete: false, retainedPrevious: true }
}
