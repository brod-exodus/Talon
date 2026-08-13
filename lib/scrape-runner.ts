import {
  completeScrape,
  getScrapeJobContributionCandidates,
  getScrapeJobContributionMap,
  getScrapeContributorUsernames,
  getScrapeJobControl,
  persistScrapeContributors,
  recordScrapeJobEvent,
  updateScrapeProgress,
  updateScrapeJobState,
  upsertScrapeJobContributionTotals,
  type ScrapeJobRow,
  type ScrapeContributorProfile,
} from "@/lib/db"
import { createGitHubClient, extractContactsFromBio, extractSocialContacts, GitHubApiError } from "@/lib/github"
import {
  planHydrationStep,
  planOrganizationDiscoveryStep,
  SCRAPE_HYDRATION_BATCH_SIZE,
} from "@/lib/scrape-step"
import { isScrapeJobCancellationRequested } from "@/lib/scrape-job-policy"
import { logWarn } from "@/lib/logger"

type ScrapeJobState = {
  phase?: "discover" | "hydrate"
  repoIndex?: number
  repositories?: string[]
}

export class ScrapeJobCanceledError extends Error {
  constructor(message = "Scrape canceled") {
    super(message)
    this.name = "ScrapeJobCanceledError"
  }
}

export class ScrapeJobLeaseLostError extends Error {
  constructor(status: string) {
    super(`Scrape worker lease was lost; job is now ${status}`)
    this.name = "ScrapeJobLeaseLostError"
  }
}

async function finishScrape(job: ScrapeJobRow): Promise<boolean> {
  const transition = await completeScrape(job, [])
  if (transition.applied) return true
  if (transition.status === "canceled") throw new ScrapeJobCanceledError()
  throw new ScrapeJobLeaseLostError(transition.status)
}

function mergeContacts(
  structured: { email?: string; twitter?: string; linkedin?: string; website?: string },
  fromBio: ReturnType<typeof extractContactsFromBio>,
  fromSocial: { twitter?: string; linkedin?: string } = {}
) {
  return {
    email: structured.email ?? fromBio.email,
    twitter: fromSocial.twitter ?? structured.twitter,
    linkedin: fromSocial.linkedin ?? structured.linkedin ?? fromBio.linkedin,
    website: structured.website ?? fromBio.website,
  }
}

async function hydrateContributor(
  githubClient: ReturnType<typeof createGitHubClient>,
  login: string,
  contributions: number,
  context: { requestId?: string | null; jobId: string; scrapeId: string }
): Promise<ScrapeContributorProfile> {
  let details
  try {
    details = await githubClient.getUserDetails(login)
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      logWarn("scrape.contributor_unavailable", {
        originRequestId: context.requestId,
        jobId: context.jobId,
        scrapeId: context.scrapeId,
        details: { githubStatus: error.status },
      })
      return {
        username: login,
        name: login,
        avatar: "",
        contributions,
        contacts: {},
      }
    }
    throw error
  }

  const socialAccounts = await githubClient.getUserSocialAccounts(login)
  const bioContacts = extractContactsFromBio(details.bio)
  const blogContacts = extractContactsFromBio(details.blog)
  const fromSocial = extractSocialContacts(socialAccounts)
  const structured = {
    email: details.email || undefined,
    twitter: details.twitter_username || blogContacts.twitter || undefined,
    linkedin: blogContacts.linkedin ?? undefined,
    website: details.blog && !/(linkedin\.com|twitter\.com|x\.com)/i.test(details.blog) ? details.blog : undefined,
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
  if (isScrapeJobCancellationRequested(control)) {
    throw new ScrapeJobCanceledError()
  }
}

async function hydrateCandidates(
  job: ScrapeJobRow,
  candidates: Array<{ login: string; contributions: number }>,
  progressBase = 0,
  progressSpan = 100
): Promise<boolean> {
  const githubClient = createGitHubClient()
  const alreadyLinked = await getScrapeContributorUsernames(job.scrape_id)
  const step = planHydrationStep(candidates, alreadyLinked, SCRAPE_HYDRATION_BATCH_SIZE)

  await updateScrapeJobState(job.id, {
    ...((job.state ?? {}) as ScrapeJobState),
    phase: "hydrate",
  })
  await recordScrapeJobEvent(job.id, job.scrape_id, "hydrate_started", "Contributor hydration started", {
    totalCandidates: candidates.length,
    alreadyLinked: alreadyLinked.size,
  })

  if (!step.batch.length) return true

  await ensureNotCanceled(job.id)
  const batch = step.batch
  const processed = step.processedAfterStep
  const progress = progressBase + Math.round((processed / Math.max(candidates.length, 1)) * progressSpan)

  await updateScrapeProgress(job.scrape_id, {
    current: processed,
    total: candidates.length,
    progress: Math.min(99, progress),
    current_user_login: batch[0]?.login ?? null,
  })

  const batchResults = await Promise.allSettled(
    batch.map(({ login, contributions }) => hydrateContributor(githubClient, login, contributions, {
      requestId: job.request_id,
      jobId: job.id,
      scrapeId: job.scrape_id,
    }))
  )
  const fulfilled = batchResults.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
  const rejected = batchResults.find((result) => result.status === "rejected")

  if (fulfilled.length) {
    await persistScrapeContributors(job.scrape_id, fulfilled)
    await recordScrapeJobEvent(job.id, job.scrape_id, "contributors_persisted", "Persisted hydrated contributors", {
      count: fulfilled.length,
      processed,
      total: candidates.length,
    })
  }

  if (rejected?.status === "rejected") {
    throw rejected.reason instanceof Error ? rejected.reason : new Error("Contributor hydration failed")
  }

  return step.completesHydration
}

async function scrapeOrganization(job: ScrapeJobRow): Promise<boolean> {
  const scrapeId = job.scrape_id
  const org = job.target
  const minContributions = job.min_contributions
  const initialState = (job.state ?? {}) as ScrapeJobState
  let repositories = initialState.repositories
  if (!repositories?.length) {
    const githubClient = createGitHubClient()
    const allRepos = await githubClient.getOrgRepos(org)
    if (!allRepos?.length) {
      throw new Error(`No repositories found for organization "${org}". Please check the organization name.`)
    }
    repositories = allRepos.filter((repo) => !repo.fork && !repo.archived).map((repo) => repo.full_name)
    if (!repositories.length) {
      throw new Error(`No non-forked repositories found for organization "${org}".`)
    }
    await updateScrapeJobState(job.id, { ...initialState, repositories })
  }

  const repos = repositories
  const discovery = planOrganizationDiscoveryStep(repos.length, initialState.repoIndex ?? 0)
  if (initialState.phase !== "hydrate" && discovery.hasRepository) {
    await ensureNotCanceled(job.id)

    const repo = repos[discovery.repoIndex]
    const githubClient = createGitHubClient()
    await updateScrapeProgress(scrapeId, {
      current: discovery.nextRepoIndex,
      total: repos.length,
      progress: Math.round((discovery.nextRepoIndex / repos.length) * 50),
      current_user_login: null,
    })

    const contribSumMap = await getScrapeJobContributionMap(job.id)
    const contributors = await githubClient.getRepoContributors(repo)
    const changedTotals: Array<{ login: string; contributions: number }> = []
    for (const contributor of contributors) {
      const contributions = (contribSumMap.get(contributor.login) ?? 0) + contributor.contributions
      contribSumMap.set(contributor.login, contributions)
      changedTotals.push({ login: contributor.login, contributions })
    }
    await upsertScrapeJobContributionTotals(job.id, changedTotals)
    await updateScrapeJobState(job.id, {
      phase: discovery.completesDiscovery ? "hydrate" : "discover",
      repoIndex: discovery.nextRepoIndex,
      repositories: repos,
    })
    await recordScrapeJobEvent(job.id, job.scrape_id, "repository_scanned", "Scanned repository contributors", {
      repository: repo,
      repoIndex: discovery.nextRepoIndex,
      repositories: repos.length,
      contributorCount: contributors.length,
    })
    return false
  }

  const logins = await getScrapeJobContributionCandidates(job.id, minContributions)
  const hydrated = await hydrateCandidates(
    { ...job, state: { phase: "hydrate", repoIndex: repos.length, repositories: repos } },
    logins,
    50,
    50
  )
  if (!hydrated) return false
  await ensureNotCanceled(job.id)
  return await finishScrape(job)
}

async function scrapeRepository(job: ScrapeJobRow): Promise<boolean> {
  const repo = job.target
  const minContributions = job.min_contributions
  const state = (job.state ?? {}) as ScrapeJobState
  if (state.phase !== "hydrate") {
    const githubClient = createGitHubClient()
    const contributors = await githubClient.getRepoContributors(repo)

    if (!contributors?.length) {
      throw new Error(`No contributors found for repository "${repo}". Please check the repository name.`)
    }

    const candidates = contributors
      .filter((contributor) => contributor.contributions >= minContributions)
      .map((contributor) => ({ login: contributor.login, contributions: contributor.contributions }))
    await upsertScrapeJobContributionTotals(job.id, candidates)
    await updateScrapeJobState(job.id, { phase: "hydrate" })
    await recordScrapeJobEvent(job.id, job.scrape_id, "repository_scanned", "Scanned repository contributors", {
      repository: repo,
      contributorCount: contributors.length,
      candidates: candidates.length,
    })
    return false
  }

  const candidates = await getScrapeJobContributionCandidates(job.id, minContributions)
  const hydrated = await hydrateCandidates(job, candidates)
  if (!hydrated) return false
  await ensureNotCanceled(job.id)
  return await finishScrape(job)
}

export async function runScrapeJob(job: ScrapeJobRow): Promise<boolean> {
  if (!process.env.GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is required for durable scrape jobs")
  }

  if (job.type === "organization") {
    return await scrapeOrganization(job)
  }

  if (job.type === "repository") {
    return await scrapeRepository(job)
  }

  throw new Error(`Unknown scrape type: ${job.type}`)
}
