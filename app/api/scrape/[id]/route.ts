import { type NextRequest, NextResponse } from "next/server"
import { createGitHubClient, type Contributor } from "@/lib/github"
import { scrapeStorage, type ScrapeData } from "@/lib/storage"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const scrapeId = params.id
    const scrapeData = scrapeStorage.get(scrapeId)

    if (!scrapeData) {
      return NextResponse.json({ error: "Scrape not found" }, { status: 404 })
    }

    return NextResponse.json(scrapeData)
  } catch (error) {
    console.error("[v0] Get scrape error:", error)
    return NextResponse.json({ error: "Failed to get scrape status" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { type, target, token } = await request.json()
    const scrapeId = params.id

    console.log("[v0] Starting scrape:", { scrapeId, type, target })

    const initialData: ScrapeData = {
      id: scrapeId,
      type,
      target,
      status: "active",
      progress: 0,
      current: 0,
      total: 0,
      contributors: [],
      startedAt: new Date(),
    }
    scrapeStorage.set(scrapeId, initialData)

    // Process scrape in background
    if (type === "organization") {
      scrapeOrganization(scrapeId, target, token).catch((error) => {
        console.error("[v0] Organization scrape failed:", error)
        const scrapeData = scrapeStorage.get(scrapeId)
        if (scrapeData) {
          scrapeStorage.set(scrapeId, {
            ...scrapeData,
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
          })
        }
      })
    } else {
      scrapeRepository(scrapeId, target, token).catch((error) => {
        console.error("[v0] Repository scrape failed:", error)
        const scrapeData = scrapeStorage.get(scrapeId)
        if (scrapeData) {
          scrapeStorage.set(scrapeId, {
            ...scrapeData,
            status: "failed",
            error: error instanceof Error ? error.message : "Unknown error",
          })
        }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Process scrape error:", error)

    const scrapeData = scrapeStorage.get(params.id)
    if (scrapeData) {
      scrapeStorage.set(params.id, {
        ...scrapeData,
        status: "failed",
        error: error instanceof Error ? error.message : "Failed to process scrape",
      })
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process scrape" },
      { status: 500 },
    )
  }
}

async function scrapeOrganization(scrapeId: string, org: string, token?: string) {
  const githubClient = createGitHubClient(token)

  // Get all repos
  const repos = await githubClient.getOrgRepos(org)

  const allContributors = new Map<string, Contributor>()
  let processedRepos = 0

  for (const repo of repos) {
    try {
      const contributors = await githubClient.getRepoContributors(repo)

      for (const contributor of contributors) {
        if (!allContributors.has(contributor.login)) {
          allContributors.set(contributor.login, contributor)
        } else {
          const existing = allContributors.get(contributor.login)!
          existing.contributions += contributor.contributions
        }
      }
    } catch (error) {
      console.error(`[v0] Failed to get contributors for ${repo}:`, error)
      // Continue with next repo instead of failing entire scrape
    }

    processedRepos++

    // Update progress for repo processing phase
    const scrapeData = scrapeStorage.get(scrapeId)
    if (scrapeData) {
      scrapeStorage.set(scrapeId, {
        ...scrapeData,
        progress: Math.round((processedRepos / repos.length) * 50), // First 50% is repo processing
        current: processedRepos,
        total: repos.length,
      })
    }
  }

  const contributorsArray = Array.from(allContributors.values())
  const detailedContributors: any[] = []

  // Update total to reflect contributor count
  const scrapeData = scrapeStorage.get(scrapeId)
  if (scrapeData) {
    scrapeStorage.set(scrapeId, {
      ...scrapeData,
      current: 0,
      total: contributorsArray.length,
      progress: 50, // Starting contributor processing phase
    })
  }

  for (let i = 0; i < contributorsArray.length; i++) {
    const contributor = contributorsArray[i]

    try {
      const details = await githubClient.getUserDetails(contributor.login)
      detailedContributors.push({
        username: contributor.login,
        name: details.name || contributor.login,
        avatar: details.avatar_url,
        contributions: contributor.contributions,
        contacts: {
          email: details.email || undefined,
          twitter: details.twitter_username || undefined,
          linkedin: details.blog?.includes("linkedin.com") ? details.blog.split("/").pop() : undefined,
          website: details.blog && !details.blog.includes("linkedin.com") ? details.blog : undefined,
        },
      })

      const scrapeData = scrapeStorage.get(scrapeId)
      if (scrapeData) {
        scrapeStorage.set(scrapeId, {
          ...scrapeData,
          progress: 50 + Math.round(((i + 1) / contributorsArray.length) * 50),
          current: i + 1,
          total: contributorsArray.length,
          currentUser: contributor.login,
          contributors: detailedContributors,
        })
      }
    } catch (error) {
      console.error(`[v0] Failed to fetch details for ${contributor.login}:`, error)
      detailedContributors.push({
        username: contributor.login,
        name: contributor.login,
        avatar: contributor.avatar_url,
        contributions: contributor.contributions,
        contacts: {},
      })
    }
  }

  // Mark as complete
  const finalScrapeData = scrapeStorage.get(scrapeId)
  if (finalScrapeData) {
    scrapeStorage.set(scrapeId, {
      ...finalScrapeData,
      status: "completed",
      progress: 100,
      contributors: detailedContributors,
      completedAt: new Date(),
    })
  }
}

async function scrapeRepository(scrapeId: string, repo: string, token?: string) {
  const githubClient = createGitHubClient(token)

  const contributors = await githubClient.getRepoContributors(repo)
  const detailedContributors: any[] = []

  for (let i = 0; i < contributors.length; i++) {
    const contributor = contributors[i]

    try {
      const details = await githubClient.getUserDetails(contributor.login)
      detailedContributors.push({
        username: contributor.login,
        name: details.name || contributor.login,
        avatar: details.avatar_url,
        contributions: contributor.contributions,
        contacts: {
          email: details.email || undefined,
          twitter: details.twitter_username || undefined,
          linkedin: details.blog?.includes("linkedin.com") ? details.blog.split("/").pop() : undefined,
          website: details.blog && !details.blog.includes("linkedin.com") ? details.blog : undefined,
        },
      })

      // Update progress
      const scrapeData = scrapeStorage.get(scrapeId)
      if (scrapeData) {
        scrapeStorage.set(scrapeId, {
          ...scrapeData,
          progress: Math.round(((i + 1) / contributors.length) * 100),
          current: i + 1,
          total: contributors.length,
          currentUser: contributor.login,
          contributors: detailedContributors,
        })
      }
    } catch (error) {
      console.error(`[v0] Failed to fetch details for ${contributor.login}:`, error)
      detailedContributors.push({
        username: contributor.login,
        name: contributor.login,
        avatar: contributor.avatar_url,
        contributions: contributor.contributions,
        contacts: {},
      })
    }
  }

  // Mark as complete
  const finalScrapeData = scrapeStorage.get(scrapeId)
  if (finalScrapeData) {
    scrapeStorage.set(scrapeId, {
      ...finalScrapeData,
      status: "completed",
      progress: 100,
      contributors: detailedContributors,
      completedAt: new Date(),
    })
  }
}
