import {
  completeScrape,
  getScrapeJobContributionCandidates,
  getScrapeJobContributionMap,
  getScrapeContributorUsernames,
  getScrapeJobControl,
  persistScrapeContributors,
  failScrape,
  recordScrapeJobEvent,
  updateScrapeProgress,
  updateScrapeJobState,
  upsertScrapeJobContributionTotals,
  type ScrapeJobRow,
  type ScrapeContributorProfile,
} from "@/lib/db"
import { createGitHubClient, extractContactsFromBio, extractSocialContacts } from "@/lib/github"

type ScrapeJobState = {
  phase?: "discover" | "hydrate"
  repoIndex?: number
}

const BATCH_SIZE = 10

export class ScrapeJobCanceledError extends Error {
  constructor(message = "Scrape canceled") {
    super(message)
    this.name = "ScrapeJobCanceledError"
  }
}

function mergeContacts(
  structured: { email?: string; twitter?: string; linkedin?: string; website?: string },
  fromBio: ReturnType<typeof extractContactsFromBio>,
  fromSocial: { twitter?: string; linkedin?: string } = {}
) {
  return {
    email: structured.email ?? fromBio.email,
    twitter: fromSocial.twitter ?? structured.twitter ?? fromBio.twitter,
    linkedin: fromSocial.linkedin ?? structured.linkedin ?? fromBio.linkedin,
    website: structured.website ?? fromBio.website,
  }
}

async function hydrateContributor(
  githubClient: ReturnType<typeof createGitHubClient>,
  login: string,
  contributions: number
): Promise<ScrapeContributorProfile> {
  const [details, socialAccounts] = await Promise.all([
    githubClient.getUserDetails(login),
    githubClient.getUserSocialAccounts(login),
  ])
  const bioContacts = extractContactsFromBio(details.bio)
  const blogContacts = extractContactsFromBio(details.blog)
  const fromSocial = extractSocialContacts(socialAccounts)
  const structured = {
    email: details.email || undefined,
    twitter: details.twitter_username || undefined,
    linkedin: blogContacts.linkedin ?? undefined,
    website: details.blog && !details.blog.includes("linkedin.com") ? details.blog : undefined,
  }

  return {
    username: login,
    name: details.name || login,
    avatar: details.avatar_url,
    contributions,
    bio: details.bio || undefined,
    location: details.location || undefined,
    company: details.company || undefined,
    contacts: mergeContacts(structured, bioContacts, fromSocial),
  }
}

async function ensureNotCanceled(jobId: string): Promise<void> {
  const control = await getScrapeJobControl(jobId)
  if (control?.cancel_requested || control?.status === "canceled") {
    throw new ScrapeJobCanceledError()
  }
}

async function hydrateCandidates(
  job: ScrapeJobRow,
  candidates: Array<{ login: string; contributions: number }>,
  progressBase = 0,
  progressSpan = 100
): Promise<void> {
  const githubClient = createGitHubClient()
  const alreadyLinked = await getScrapeContributorUsernames(job.scrape_id)
  const remaining = candidates.filter((candidate) => !alreadyLinked.has(candidate.login))

  await updateScrapeJobState(job.id, {
    ...((job.state ?? {}) as ScrapeJobState),
    phase: "hydrate",
  })
  await recordScrapeJobEvent(job.id, job.scrape_id, "hydrate_started", "Contributor hydration started", {
    totalCandidates: candidates.length,
    alreadyLinked: alreadyLinked.size,
  })

  for (let batchStart = 0; batchStart < remaining.length; batchStart += BATCH_SIZE) {
    await ensureNotCanceled(job.id)

    const batch = remaining.slice(batchStart, batchStart + BATCH_SIZE)
    const processed = alreadyLinked.size + Math.min(batchStart + BATCH_SIZE, remaining.length)
    const progress = progressBase + Math.round((processed / Math.max(candidates.length, 1)) * progressSpan)

    await updateScrapeProgress(job.scrape_id, {
      current: processed,
      total: candidates.length,
      progress: Math.min(99, progress),
      current_user_login: batch[0]?.login ?? null,
    })

    const batchResults = await Promise.allSettled(
      batch.map(({ login, contributions }) => hydrateContributor(githubClient, login, contributions))
    )
    const fulfilled = batchResults.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    const rejected = batchResults.find((result) => result.status === "rejected")

    if (fulfilled.length) {
      await persistScrapeContributors(job.scrape_id, fulfilled)
      for (const contributor of fulfilled) alreadyLinked.add(contributor.username)
      await recordScrapeJobEvent(job.id, job.scrape_id, "contributors_persisted", "Persisted hydrated contributors", {
        count: fulfilled.length,
        processed,
        total: candidates.length,
      })
    }

    if (rejected?.status === "rejected") {
      throw rejected.reason instanceof Error ? rejected.reason : new Error("Contributor hydration failed")
    }
  }
}

async function scrapeOrganization(job: ScrapeJobRow) {
  const scrapeId = job.scrape_id
  const org = job.target
  const minContributions = job.min_contributions
  const githubClient = createGitHubClient()
  const allRepos = await githubClient.getOrgRepos(org)

  if (!allRepos?.length) {
    await failScrape(scrapeId, `No repositories found for organization "${org}". Please check the organization name.`)
    return
  }

  const repos = allRepos.filter((repo) => !repo.fork && !repo.archived)
  if (!repos.length) {
    await failScrape(scrapeId, `No non-forked repositories found for organization "${org}".`)
    return
  }

  const initialState = (job.state ?? {}) as ScrapeJobState
  const contribSumMap = await getScrapeJobContributionMap(job.id)
  const startRepoIndex = initialState.phase === "hydrate" ? repos.length : initialState.repoIndex ?? 0
  await recordScrapeJobEvent(job.id, job.scrape_id, "discover_started", "Organization repository discovery started", {
    repositories: repos.length,
    startRepoIndex,
  })

  for (let i = startRepoIndex; i < repos.length; i++) {
    await ensureNotCanceled(job.id)

    const repo = repos[i]
    await updateScrapeProgress(scrapeId, {
      current: i + 1,
      total: repos.length,
      progress: Math.round(((i + 1) / repos.length) * 50),
      current_user_login: null,
    })

    const contributors = await githubClient.getRepoContributors(repo.full_name)
    const changedTotals: Array<{ login: string; contributions: number }> = []
    for (const contributor of contributors) {
      const contributions = (contribSumMap.get(contributor.login) ?? 0) + contributor.contributions
      contribSumMap.set(contributor.login, contributions)
      changedTotals.push({ login: contributor.login, contributions })
    }
    await upsertScrapeJobContributionTotals(job.id, changedTotals)
    await updateScrapeJobState(job.id, {
      phase: "discover",
      repoIndex: i + 1,
    })
    await recordScrapeJobEvent(job.id, job.scrape_id, "repository_scanned", "Scanned repository contributors", {
      repository: repo.full_name,
      repoIndex: i + 1,
      repositories: repos.length,
      contributorCount: contributors.length,
    })
  }

  const logins = await getScrapeJobContributionCandidates(job.id, minContributions)

  await hydrateCandidates(
    { ...job, state: { phase: "hydrate", repoIndex: repos.length } },
    logins,
    50,
    50
  )
  await ensureNotCanceled(job.id)
  await completeScrape(scrapeId, [])
}

async function scrapeRepository(job: ScrapeJobRow) {
  const scrapeId = job.scrape_id
  const repo = job.target
  const minContributions = job.min_contributions
  const githubClient = createGitHubClient()
  const contributors = await githubClient.getRepoContributors(repo)

  if (!contributors?.length) {
    await failScrape(scrapeId, `No contributors found for repository "${repo}". Please check the repository name.`)
    return
  }

  const candidates = contributors
    .filter((contributor) => contributor.contributions >= minContributions)
    .map((contributor) => ({ login: contributor.login, contributions: contributor.contributions }))

  await recordScrapeJobEvent(job.id, job.scrape_id, "repository_scanned", "Scanned repository contributors", {
    repository: repo,
    contributorCount: contributors.length,
    candidates: candidates.length,
  })
  await hydrateCandidates(job, candidates)
  await ensureNotCanceled(job.id)
  await completeScrape(scrapeId, [])
}

export async function runScrapeJob(job: ScrapeJobRow): Promise<void> {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is required for durable scrape jobs")
  }

  if (job.type === "organization") {
    await scrapeOrganization(job)
    return
  }

  if (job.type === "repository") {
    await scrapeRepository(job)
    return
  }

  throw new Error(`Unknown scrape type: ${job.type}`)
}
