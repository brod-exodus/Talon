import {
  checkpointCachedScrapeHydrationBatch,
  checkpointOrganizationContributorPage,
  checkpointScrapeHydrationBatch,
  checkpointScrapeJob,
  completeScrape,
  getScrapeJobContributionCandidates,
  getScrapeContributorUsernames,
  getFreshContributorUsernames,
  getScrapeJobControl,
  recordScrapeJobEvent,
  upsertScrapeJobContributionTotals,
  type ScrapeJobRow,
  type ScrapeContributorProfile,
} from "@/lib/db"
import { createGitHubClient, extractContactsFromBio, extractSocialContacts, GitHubApiError } from "@/lib/github"
import {
  contributorProfileFreshAfter,
  planHydrationStep,
  planOrganizationDiscoveryStep,
  planOrganizationRepositoryPage,
  planRepositoryContributorPage,
  SCRAPE_HYDRATION_BATCH_SIZE,
  splitHydrationBatchByProfileCache,
} from "@/lib/scrape-step"
import { isScrapeJobCancellationRequested } from "@/lib/scrape-job-policy"
import { logWarn } from "@/lib/logger"

type ScrapeJobState = {
  phase?: "discover" | "hydrate"
  repoIndex?: number
  repositories?: string[]
  repositoryPage?: number
  repositoryDiscoveryComplete?: boolean
  contributorPage?: number
}

const WORKER_GITHUB_REQUEST_TIMEOUT_MS = 10_000
const WORKER_GITHUB_MAX_RETRIES = 0

function createWorkerGitHubClient() {
  return createGitHubClient(undefined, {
    requestTimeoutMs: WORKER_GITHUB_REQUEST_TIMEOUT_MS,
    maxRetries: WORKER_GITHUB_MAX_RETRIES,
  })
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

async function saveScrapeCheckpoint(
  job: ScrapeJobRow,
  checkpoint: Parameters<typeof checkpointScrapeJob>[1]
): Promise<void> {
  const transition = await checkpointScrapeJob(job, checkpoint)
  if (transition.applied) return
  if (transition.status === "canceled") throw new ScrapeJobCanceledError()
  throw new ScrapeJobLeaseLostError(transition.status)
}

async function finishScrape(job: ScrapeJobRow): Promise<boolean> {
  const transition = await completeScrape(job)
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
  candidates: Array<{ login: string; contributions: number }>
): Promise<boolean> {
  const githubClient = createWorkerGitHubClient()
  const alreadyLinked = await getScrapeContributorUsernames(job.scrape_id)
  const step = planHydrationStep(candidates, alreadyLinked, SCRAPE_HYDRATION_BATCH_SIZE)

  if (!step.batch.length) return true

  await ensureNotCanceled(job.id)
  const batch = step.batch
  const freshUsernames = await getFreshContributorUsernames(
    job.team_id,
    batch.map((candidate) => candidate.login),
    contributorProfileFreshAfter()
  )
  const profilePlan = splitHydrationBatchByProfileCache(batch, freshUsernames)

  await recordScrapeJobEvent(job.id, job.scrape_id, "hydrate_started", "Contributor hydration started", {
    totalCandidates: candidates.length,
    alreadyLinked: alreadyLinked.size,
    cachedProfiles: profilePlan.cached.length,
    githubRefreshes: profilePlan.refresh.length,
  })

  if (profilePlan.cached.length) {
    const transition = await checkpointCachedScrapeHydrationBatch(job, profilePlan.cached)
    if (!transition.applied) {
      if (transition.status === "canceled") throw new ScrapeJobCanceledError()
      throw new ScrapeJobLeaseLostError(transition.status)
    }
  }

  if (!profilePlan.refresh.length) return step.completesHydration
  await ensureNotCanceled(job.id)

  const batchResults = await Promise.allSettled(
    profilePlan.refresh.map(({ login, contributions }) => hydrateContributor(githubClient, login, contributions, {
      requestId: job.request_id,
      jobId: job.id,
      scrapeId: job.scrape_id,
    }))
  )
  const fulfilled = batchResults.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
  const rejected = batchResults.find((result) => result.status === "rejected")

  if (fulfilled.length) {
    const transition = await checkpointScrapeHydrationBatch(job, fulfilled)
    if (!transition.applied) {
      if (transition.status === "canceled") throw new ScrapeJobCanceledError()
      throw new ScrapeJobLeaseLostError(transition.status)
    }
  }

  if (rejected?.status === "rejected") {
    throw rejected.reason instanceof Error ? rejected.reason : new Error("Contributor hydration failed")
  }

  return step.completesHydration
}

async function scrapeOrganization(job: ScrapeJobRow): Promise<boolean> {
  const org = job.target
  const minContributions = job.min_contributions
  const initialState = (job.state ?? {}) as ScrapeJobState
  let repositories = initialState.repositories ?? []
  const isLegacyDiscoveryComplete =
    repositories.length > 0 &&
    initialState.repositoryPage === undefined &&
    initialState.repositoryDiscoveryComplete === undefined
  const repositoryDiscoveryComplete = initialState.repositoryDiscoveryComplete ?? isLegacyDiscoveryComplete

  if (!repositoryDiscoveryComplete) {
    await ensureNotCanceled(job.id)
    const pagePlan = planOrganizationRepositoryPage(initialState.repositoryPage ?? 1, true)
    const githubClient = createWorkerGitHubClient()
    const page = await githubClient.getOrgReposPage(org, pagePlan.scannedPage)
    if (pagePlan.scannedPage === 1 && !page.repositories.length) {
      throw new Error(`No repositories found for organization "${org}". Please check the organization name.`)
    }

    repositories = Array.from(new Set([
      ...repositories,
      ...page.repositories.filter((repo) => !repo.fork && !repo.archived).map((repo) => repo.full_name),
    ]))
    const completedPage = planOrganizationRepositoryPage(page.page, page.hasNext)
    if (completedPage.completesDiscovery && !repositories.length) {
      throw new Error(`No non-forked repositories found for organization "${org}".`)
    }

    await saveScrapeCheckpoint(job, {
      state: {
        ...initialState,
        phase: "discover",
        repositories,
        repositoryPage: completedPage.nextPage,
        repositoryDiscoveryComplete: completedPage.completesDiscovery,
      },
    })
    await recordScrapeJobEvent(
      job.id,
      job.scrape_id,
      "organization_repository_page_scanned",
      "Scanned organization repository page",
      {
        organization: org,
        page: completedPage.scannedPage,
        hasNext: page.hasNext,
        repositoriesFound: page.repositories.length,
        eligibleRepositories: repositories.length,
      }
    )
    return false
  }

  const repos = repositories
  const discovery = planOrganizationDiscoveryStep(repos.length, initialState.repoIndex ?? 0)
  if (initialState.phase !== "hydrate" && discovery.hasRepository) {
    await ensureNotCanceled(job.id)

    const repo = repos[discovery.repoIndex]
    const contributorPage = Math.max(1, Math.floor(initialState.contributorPage ?? 1))
    const githubClient = createWorkerGitHubClient()
    const page = await githubClient.getRepoContributorsPage(repo, contributorPage)
    const transition = await checkpointOrganizationContributorPage(job, {
      repository: repo,
      repoIndex: discovery.repoIndex,
      page: page.page,
      hasNext: page.hasNext,
      contributors: page.contributors.map((contributor) => ({
        login: contributor.login,
        contributions: contributor.contributions,
      })),
    })
    if (!transition.applied) {
      if (transition.status === "canceled") throw new ScrapeJobCanceledError()
      throw new ScrapeJobLeaseLostError(transition.status)
    }
    return false
  }

  const logins = await getScrapeJobContributionCandidates(job.id, minContributions)
  const hydrated = await hydrateCandidates({
    ...job,
    state: {
      phase: "hydrate",
      repoIndex: repos.length,
      repositories: repos,
      repositoryPage: initialState.repositoryPage,
      repositoryDiscoveryComplete: true,
    },
  }, logins)
  if (!hydrated) return false
  await ensureNotCanceled(job.id)
  return await finishScrape(job)
}

async function scrapeRepository(job: ScrapeJobRow): Promise<boolean> {
  const repo = job.target
  const minContributions = job.min_contributions
  const state = (job.state ?? {}) as ScrapeJobState
  if (state.phase !== "hydrate") {
    await ensureNotCanceled(job.id)
    const pagePlan = planRepositoryContributorPage(state.contributorPage ?? 1, true)
    const githubClient = createWorkerGitHubClient()
    const page = await githubClient.getRepoContributorsPage(repo, pagePlan.scannedPage)
    const contributors = page.contributors

    if (pagePlan.scannedPage === 1 && !contributors.length) {
      throw new Error(`No contributors found for repository "${repo}". Please check the repository name.`)
    }

    const candidates = contributors
      .filter((contributor) => contributor.contributions >= minContributions)
      .map((contributor) => ({ login: contributor.login, contributions: contributor.contributions }))
    await upsertScrapeJobContributionTotals(job.id, candidates)
    const completedPage = planRepositoryContributorPage(page.page, page.hasNext)
    await saveScrapeCheckpoint(job, {
      state: {
        phase: completedPage.completesDiscovery ? "hydrate" : "discover",
        contributorPage: completedPage.nextPage,
      },
    })
    await recordScrapeJobEvent(
      job.id,
      job.scrape_id,
      "repository_contributor_page_scanned",
      "Scanned repository contributor page",
      {
        repository: repo,
        page: completedPage.scannedPage,
        hasNext: page.hasNext,
        contributorCount: contributors.length,
        candidates: candidates.length,
      }
    )
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
