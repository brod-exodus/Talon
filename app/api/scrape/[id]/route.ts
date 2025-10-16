import { type NextRequest, NextResponse } from "next/server"
import { createGitHubClient } from "@/lib/github"
import { getScrape, updateScrape, addContributor, deleteScrape } from "@/lib/storage-local"

function isBotAccount(username: string): boolean {
  return (
    username.endsWith("[bot]") ||
    username === "Copilot" ||
    username === "dependabot" ||
    username === "renovate" ||
    username === "greenkeeper"
  )
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id: scrapeId } = params
    const scrape = await getScrape(scrapeId)

    if (!scrape) {
      return NextResponse.json({ error: "Scrape not found" }, { status: 404 })
    }

    return NextResponse.json(scrape)
  } catch (error) {
    console.error("[v0] Get scrape error:", error)
    return NextResponse.json({ error: "Failed to get scrape status" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    console.log("[v0] POST /api/scrape/[id] - Request received for ID:", params.id)
    const { type, target, token } = await request.json()
    const { id: scrapeId } = params

    console.log("[v0] Starting scrape process:", { scrapeId, type, target, hasToken: !!token })

    if (type === "organization") {
      console.log("[v0] Starting organization scrape")
      scrapeOrganization(scrapeId, target, token).catch(async (error) => {
        console.error("[v0] Organization scrape failed:", error)
        await updateScrape(scrapeId, {
          status: "failed",
        })
      })
    } else if (type === "repository") {
      console.log("[v0] Starting repository scrape")
      scrapeRepository(scrapeId, target, token).catch(async (error) => {
        console.error("[v0] Repository scrape failed:", error)
        await updateScrape(scrapeId, {
          status: "failed",
        })
      })
    }

    console.log("[v0] Scrape process initiated, returning success")
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Process scrape error:", error)
    await updateScrape(params.id, {
      status: "failed",
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process scrape" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id: scrapeId } = params
    await deleteScrape(scrapeId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Delete scrape error:", error)
    return NextResponse.json({ error: "Failed to delete scrape" }, { status: 500 })
  }
}

async function scrapeOrganization(scrapeId: string, org: string, token?: string) {
  console.log("[v0] scrapeOrganization started:", { scrapeId, org })
  const githubClient = createGitHubClient(token)
  const scrape = await getScrape(scrapeId)
  if (!scrape) {
    console.log("[v0] Scrape not found in database:", scrapeId)
    return
  }

  try {
    const rateLimit = await githubClient.getRateLimitInfo()
    if (rateLimit) {
      console.log(`[v0] Starting scrape with ${rateLimit.remaining}/${rateLimit.limit} API requests remaining`)
    }

    console.log("[v0] Fetching repos for org:", org)
    const repos = await githubClient.getOrgRepos(org)
    console.log("[v0] Found repos:", repos?.length || 0)

    if (!repos || repos.length === 0) {
      await updateScrape(scrapeId, { status: "failed" })
      return
    }

    await updateScrape(scrapeId, { total: repos.length })

    const contributorMap = new Map<
      string,
      {
        username: string
        name: string
        avatar: string
        contributions: number
        bio?: string
        location?: string
        company?: string
        contacts: {
          email?: string
          twitter?: string
          linkedin?: string
          website?: string
        }
      }
    >()

    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i]
      await updateScrape(scrapeId, {
        current: i + 1,
        progress: Math.round(((i + 1) / repos.length) * 100),
      })

      try {
        const contributors = await githubClient.getRepoContributors(repo)

        for (const contributor of contributors) {
          const existing = contributorMap.get(contributor.login)
          if (existing) {
            existing.contributions += contributor.contributions
          } else {
            if (isBotAccount(contributor.login)) {
              console.log(`[v0] Skipping bot account: ${contributor.login}`)
              contributorMap.set(contributor.login, {
                username: contributor.login,
                name: contributor.login,
                avatar: contributor.avatar_url,
                contributions: contributor.contributions,
                bio: "Bot account",
                location: undefined,
                company: undefined,
                contacts: {},
              })
              continue
            }

            try {
              const details = await githubClient.getUserDetails(contributor.login)
              contributorMap.set(contributor.login, {
                username: contributor.login,
                name: details.name || contributor.login,
                avatar: details.avatar_url,
                contributions: contributor.contributions,
                bio: details.bio || undefined,
                location: details.location || undefined,
                company: details.company || undefined,
                contacts: {
                  email: details.email || undefined,
                  twitter: details.twitter_username || undefined,
                  website: details.blog && !details.blog.includes("linkedin.com") ? details.blog : undefined,
                },
              })
            } catch (error) {
              console.error(`[v0] Failed to get details for ${contributor.login}:`, error)
              contributorMap.set(contributor.login, {
                username: contributor.login,
                name: contributor.login,
                avatar: contributor.avatar_url,
                contributions: contributor.contributions,
                bio: undefined,
                location: undefined,
                company: undefined,
                contacts: {},
              })
            }
          }
        }
      } catch (error) {
        console.error(`[v0] Failed to get contributors for ${repo}:`, error)
      }
    }

    for (const contributor of contributorMap.values()) {
      await addContributor(scrapeId, contributor)
    }

    await updateScrape(scrapeId, {
      status: "completed",
      completedAt: new Date(),
    })
  } catch (error) {
    await updateScrape(scrapeId, { status: "failed" })
    throw error
  }
}

async function scrapeRepository(scrapeId: string, repo: string, token?: string) {
  console.log("[v0] scrapeRepository started:", { scrapeId, repo })
  const githubClient = createGitHubClient(token)
  const scrape = await getScrape(scrapeId)
  if (!scrape) {
    console.log("[v0] Scrape not found in database:", scrapeId)
    return
  }

  try {
    const rateLimit = await githubClient.getRateLimitInfo()
    if (rateLimit) {
      console.log(`[v0] Starting scrape with ${rateLimit.remaining}/${rateLimit.limit} API requests remaining`)
    }

    console.log("[v0] Fetching contributors for repo:", repo)
    const contributors = await githubClient.getRepoContributors(repo)
    console.log("[v0] Found contributors:", contributors?.length || 0)

    if (!contributors || contributors.length === 0) {
      await updateScrape(scrapeId, { status: "failed" })
      return
    }

    await updateScrape(scrapeId, { total: contributors.length })

    for (let i = 0; i < contributors.length; i++) {
      const contributor = contributors[i]
      await updateScrape(scrapeId, {
        current: i + 1,
        progress: Math.round(((i + 1) / contributors.length) * 100),
      })

      if (isBotAccount(contributor.login)) {
        console.log(`[v0] Skipping bot account: ${contributor.login}`)
        await addContributor(scrapeId, {
          username: contributor.login,
          name: contributor.login,
          avatar: contributor.avatar_url,
          contributions: contributor.contributions,
          bio: "Bot account",
          location: undefined,
          company: undefined,
          contacts: {},
        })
        continue
      }

      try {
        const details = await githubClient.getUserDetails(contributor.login)

        await addContributor(scrapeId, {
          username: contributor.login,
          name: details.name || contributor.login,
          avatar: details.avatar_url,
          contributions: contributor.contributions,
          bio: details.bio || undefined,
          location: details.location || undefined,
          company: details.company || undefined,
          contacts: {
            email: details.email || undefined,
            twitter: details.twitter_username || undefined,
            website: details.blog && !details.blog.includes("linkedin.com") ? details.blog : undefined,
          },
        })
      } catch (error) {
        console.error(`[v0] Failed to get details for ${contributor.login}:`, error)
        await addContributor(scrapeId, {
          username: contributor.login,
          name: contributor.login,
          avatar: contributor.avatar_url,
          contributions: contributor.contributions,
          bio: undefined,
          location: undefined,
          company: undefined,
          contacts: {},
        })
      }
    }

    await updateScrape(scrapeId, {
      status: "completed",
      completedAt: new Date(),
    })
  } catch (error) {
    await updateScrape(scrapeId, { status: "failed" })
    throw error
  }
}
