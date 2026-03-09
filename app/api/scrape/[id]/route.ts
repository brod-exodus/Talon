import { type NextRequest, NextResponse } from "next/server"
import { after } from "next/server"
import { createGitHubClient, extractContactsFromBio, extractSocialContacts } from "@/lib/github"
import { getScrapeMetadata, getScrapeContributorsPage, failScrape, deleteScrape, updateScrapeProgress, completeScrape } from "@/lib/db"

/**
 * Merge contacts from three sources, highest priority first:
 *   1. fromSocial  — /social_accounts API (explicitly set by the user in GitHub settings)
 *   2. structured  — top-level profile fields (email, twitter_username, blog)
 *   3. fromBio     — regex-parsed from free-text bio / blog field
 */
function mergeContacts(
  structured: { email?: string; twitter?: string; linkedin?: string; website?: string },
  fromBio: ReturnType<typeof extractContactsFromBio>,
  fromSocial: { twitter?: string; linkedin?: string } = {}
) {
  return {
    email:    structured.email    ?? fromBio.email,
    twitter:  fromSocial.twitter  ?? structured.twitter  ?? fromBio.twitter,
    linkedin: fromSocial.linkedin ?? structured.linkedin ?? fromBio.linkedin,
    website:  structured.website  ?? fromBio.website,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  console.log("[route] GET", request.url)
  try {
    const { id: scrapeId } = await params
    const pageParam = request.nextUrl.searchParams.get("page")

    // Paginated path: used by the UI when loading contributor details.
    // Uses getScrapeMetadata (scrapes table only) to avoid the unbounded
    // .in() query that getScrape() runs against the contributors table.
    if (pageParam !== null) {
      const page = Math.max(1, parseInt(pageParam, 10) || 1)
      const scrape = await getScrapeMetadata(scrapeId)
      if (!scrape) {
        return NextResponse.json({ error: "Scrape not found" }, { status: 404 })
      }
      const pageData = await getScrapeContributorsPage(scrapeId, page)
      return NextResponse.json({
        id: scrape.id,
        type: scrape.type,
        target: scrape.target,
        status: scrape.status,
        progress: scrape.progress,
        current: scrape.current,
        total: scrape.total,
        currentUser: scrape.currentUser,
        startedAt: scrape.startedAt,
        completedAt: scrape.completedAt,
        error: scrape.error,
        contributors: pageData.contributors,
        contributorTotal: pageData.contributorTotal,
        page: pageData.page,
        hasMore: pageData.hasMore,
      })
    }

    // ?page is required — reject requests that omit it so getScrape() is never called.
    console.trace("[route] GET called without ?page – scrapeId=" + scrapeId)
    return NextResponse.json({ error: "Missing required query parameter: page" }, { status: 400 })
  } catch (error) {
    console.error("[v0] Get scrape error – full error:", error)
    if (error && typeof error === "object") {
      console.error("[v0] Get scrape error detail:", JSON.stringify(error, null, 2))
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get scrape status" },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: scrapeId } = await params
  try {
    const { type, target, token, minContributions } = await request.json()
    const minC: number = Math.max(1, Math.floor(Number(minContributions) || 1))

    console.log("[v0] Starting scrape:", { scrapeId, type, target, minContributions: minC })

    if (type === "organization") {
      after(async () => {
        await scrapeOrganization(scrapeId, target, token, minC).catch((error) => {
          console.error("[v0] Organization scrape failed – full error:", error)
          return failScrape(scrapeId, error instanceof Error ? error.message : "Unknown error")
        })
      })
    } else if (type === "repository") {
      after(async () => {
        await scrapeRepository(scrapeId, target, token, minC).catch((error) => {
          console.error("[v0] Repository scrape failed – full error:", error)
          return failScrape(scrapeId, error instanceof Error ? error.message : "Unknown error")
        })
      })
    } else {
      console.warn("[v0] Unknown scrape type:", type)
      await failScrape(scrapeId, `Unknown scrape type: ${type}`)
      return NextResponse.json({ error: `Unknown scrape type: ${type}` }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Process scrape error – full error:", error)
    await failScrape(scrapeId, error instanceof Error ? error.message : "Failed to process scrape").catch(
      console.error
    )
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process scrape" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: scrapeId } = await params
    await deleteScrape(scrapeId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Delete scrape error:", error)
    return NextResponse.json({ error: "Failed to delete scrape" }, { status: 500 })
  }
}

const BATCH_SIZE = 10

async function scrapeOrganization(scrapeId: string, org: string, token?: string, minContributions = 1) {
  const githubClient = createGitHubClient(token)

  try {
    const allRepos = await githubClient.getOrgRepos(org)

    if (!allRepos || allRepos.length === 0) {
      await failScrape(
        scrapeId,
        `No repositories found for organization "${org}". Please check the organization name.`
      )
      return
    }

    const repos = allRepos.filter((repo) => !repo.fork && !repo.archived)
    console.log("[v0] Filtered repos:", repos.length, "out of", allRepos.length, "(excluded forks and archived)")

    if (repos.length === 0) {
      await failScrape(scrapeId, `No non-forked repositories found for organization "${org}".`)
      return
    }

    // ── Phase 1: scan all repos to accumulate contribution counts ──────────
    // No detail fetches here — just login → total contributions across all repos.
    const contribSumMap = new Map<string, number>()

    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i]
      await updateScrapeProgress(scrapeId, {
        current: i + 1,
        total: repos.length,
        progress: Math.round(((i + 1) / repos.length) * 50), // 0–50 %
        current_user_login: null,
      })
      try {
        const contributors = await githubClient.getRepoContributors(repo.full_name)
        for (const c of contributors) {
          contribSumMap.set(c.login, (contribSumMap.get(c.login) ?? 0) + c.contributions)
        }
      } catch (error) {
        console.error(`[v0] Failed to get contributors for ${repo.full_name}:`, error)
      }
    }

    // Apply minContributions filter before fetching any user details.
    const logins = Array.from(contribSumMap.entries())
      .filter(([, count]) => count >= minContributions)
      .map(([login, contributions]) => ({ login, contributions }))

    console.log(
      `[v0] Unique contributors after minContributions=${minContributions} filter: ${logins.length} (from ${contribSumMap.size} total)`
    )

    // ── Phase 2: batch-fetch user details (10 at a time) ───────────────────
    type ContribShape = {
      username: string; name: string; avatar: string; contributions: number
      bio?: string; location?: string; company?: string
      contacts: { email?: string; twitter?: string; linkedin?: string; website?: string }
    }
    const results: ContribShape[] = []

    for (let batchStart = 0; batchStart < logins.length; batchStart += BATCH_SIZE) {
      const batch = logins.slice(batchStart, batchStart + BATCH_SIZE)
      const processed = Math.min(batchStart + BATCH_SIZE, logins.length)

      await updateScrapeProgress(scrapeId, {
        current: processed,
        total: logins.length,
        progress: 50 + Math.round((processed / logins.length) * 50), // 50–100 %
        current_user_login: batch[0].login,
      })

      const batchResults = await Promise.allSettled(
        batch.map(async ({ login, contributions }) => {
          const [details, socialAccounts] = await Promise.all([
            githubClient.getUserDetails(login),
            githubClient.getUserSocialAccounts(login),
          ])
          const bioContacts  = extractContactsFromBio(details.bio)
          const blogContacts = extractContactsFromBio(details.blog)
          const fromSocial   = extractSocialContacts(socialAccounts)
          const structured = {
            email:    details.email || undefined,
            twitter:  details.twitter_username || undefined,
            linkedin: blogContacts.linkedin ?? undefined,
            website:  details.blog && !details.blog.includes("linkedin.com") ? details.blog : undefined,
          }
          return {
            username:     login,
            name:         details.name || login,
            avatar:       details.avatar_url,
            contributions,
            bio:          details.bio      || undefined,
            location:     details.location || undefined,
            company:      details.company  || undefined,
            contacts:     mergeContacts(structured, bioContacts, fromSocial),
          } satisfies ContribShape
        })
      )

      for (const r of batchResults) {
        if (r.status === "fulfilled") results.push(r.value)
        else console.error("[v0] Failed to get details for contributor:", r.reason)
      }
    }

    await completeScrape(scrapeId, results)
  } catch (error) {
    console.error("[v0] Organization scrape failed – full error:", error)
    if (error instanceof Error && error.message.includes("404")) {
      await failScrape(scrapeId, `Organization "${org}" not found. Please check the spelling and try again.`)
    } else {
      await failScrape(
        scrapeId,
        error instanceof Error ? error.message : "Failed to scrape organization"
      )
    }
    throw error
  }
}

async function scrapeRepository(scrapeId: string, repo: string, token?: string, minContributions = 1) {
  const githubClient = createGitHubClient(token)

  try {
    const contributors = await githubClient.getRepoContributors(repo)

    if (!contributors || contributors.length === 0) {
      await failScrape(
        scrapeId,
        `No contributors found for repository "${repo}". Please check the repository name.`
      )
      return
    }

    type ContribShape = {
      username: string; name: string; avatar: string; contributions: number
      bio?: string; location?: string; company?: string
      contacts: { email?: string; twitter?: string; linkedin?: string; website?: string }
    }
    const list: ContribShape[] = []

    for (let batchStart = 0; batchStart < contributors.length; batchStart += BATCH_SIZE) {
      const batch = contributors.slice(batchStart, batchStart + BATCH_SIZE)
      const processed = Math.min(batchStart + BATCH_SIZE, contributors.length)

      await updateScrapeProgress(scrapeId, {
        current: processed,
        total: contributors.length,
        progress: Math.round((processed / contributors.length) * 100),
        current_user_login: batch[0].login,
      })

      const batchResults = await Promise.allSettled(
        batch.map(async (contributor) => {
          const [details, socialAccounts] = await Promise.all([
            githubClient.getUserDetails(contributor.login),
            githubClient.getUserSocialAccounts(contributor.login),
          ])
          const bioContacts  = extractContactsFromBio(details.bio)
          const blogContacts = extractContactsFromBio(details.blog)
          const fromSocial   = extractSocialContacts(socialAccounts)
          const structured = {
            email:    details.email || undefined,
            twitter:  details.twitter_username || undefined,
            linkedin: blogContacts.linkedin ?? undefined,
            website:  details.blog && !details.blog.includes("linkedin.com") ? details.blog : undefined,
          }
          return {
            username:     contributor.login,
            name:         details.name || contributor.login,
            avatar:       details.avatar_url,
            contributions: contributor.contributions,
            bio:          details.bio      || undefined,
            location:     details.location || undefined,
            company:      details.company  || undefined,
            contacts:     mergeContacts(structured, bioContacts, fromSocial),
          } satisfies ContribShape
        })
      )

      for (const r of batchResults) {
        if (r.status === "fulfilled") list.push(r.value)
        else console.error("[v0] Failed to get details for contributor:", r.reason)
      }
    }

    const filtered = list.filter((c) => c.contributions >= minContributions)
    console.log(
      `[v0] Contributors after minContributions=${minContributions} filter:`,
      filtered.length
    )

    await completeScrape(scrapeId, filtered)
  } catch (error) {
    console.error("[v0] Repository scrape failed – full error:", error)
    if (error instanceof Error && error.message.includes("404")) {
      await failScrape(scrapeId, `Repository "${repo}" not found. Please check the spelling and try again.`)
    } else {
      await failScrape(scrapeId, error instanceof Error ? error.message : "Failed to scrape repository")
    }
    throw error
  }
}
