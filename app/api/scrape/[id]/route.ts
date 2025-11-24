import { type NextRequest, NextResponse } from "next/server"
import { createGitHubClient } from "@/lib/github"
import { scrapeStorage } from "@/lib/storage"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id: scrapeId } = params
    const scrape = scrapeStorage.get(scrapeId)

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
    const { type, target, token } = await request.json()
    const { id: scrapeId } = params

    console.log("[v0] Starting scrape:", { scrapeId, type, target })

    if (type === "organization") {
      scrapeOrganization(scrapeId, target, token).catch((error) => {
        console.error("[v0] Organization scrape failed:", error)
        const scrape = scrapeStorage.get(scrapeId)
        if (scrape) {
          scrape.status = "failed"
          scrape.error = error instanceof Error ? error.message : "Unknown error"
        }
      })
    } else if (type === "repository") {
      scrapeRepository(scrapeId, target, token).catch((error) => {
        console.error("[v0] Repository scrape failed:", error)
        const scrape = scrapeStorage.get(scrapeId)
        if (scrape) {
          scrape.status = "failed"
          scrape.error = error instanceof Error ? error.message : "Unknown error"
        }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Process scrape error:", error)
    const scrape = scrapeStorage.get(params.id)
    if (scrape) {
      scrape.status = "failed"
      scrape.error = error instanceof Error ? error.message : "Failed to process scrape"
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process scrape" },
      { status: 500 },
    )
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id: scrapeId } = params
    scrapeStorage.delete(scrapeId)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Delete scrape error:", error)
    return NextResponse.json({ error: "Failed to delete scrape" }, { status: 500 })
  }
}

async function scrapeOrganization(scrapeId: string, org: string, token?: string) {
  const githubClient = createGitHubClient(token)
  const scrape = scrapeStorage.get(scrapeId)
  if (!scrape) return

  try {
    const allRepos = await githubClient.getOrgRepos(org)

    if (!allRepos || allRepos.length === 0) {
      scrape.status = "failed"
      scrape.error = `No repositories found for organization "${org}". Please check the organization name.`
      return
    }

    const repos = allRepos.filter((repo) => !repo.fork && !repo.archived)
    console.log("[v0] Filtered repos:", repos.length, "out of", allRepos.length, "(excluded forks and archived)")

    if (repos.length === 0) {
      scrape.status = "failed"
      scrape.error = `No non-forked repositories found for organization "${org}".`
      return
    }

    scrape.total = repos.length

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
      scrape.current = i + 1
      scrape.progress = Math.round(((i + 1) / repos.length) * 100)

      try {
        const contributors = await githubClient.getRepoContributors(repo.full_name)

        for (const contributor of contributors) {
          const existing = contributorMap.get(contributor.login)
          if (existing) {
            existing.contributions += contributor.contributions
          } else {
            try {
              scrape.currentUser = contributor.login
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
            }
          }
        }
      } catch (error) {
        console.error(`[v0] Failed to get contributors for ${repo.full_name}:`, error)
      }
    }

    const filteredContributors = Array.from(contributorMap.values()).filter((c) => c.contributions >= 3)
    console.log(
      "[v0] Filtered contributors:",
      filteredContributors.length,
      "out of",
      contributorMap.size,
      "(minimum 3 contributions)",
    )

    scrape.contributors = filteredContributors
    scrape.status = "completed"
    scrape.completedAt = new Date()
    scrape.currentUser = undefined
  } catch (error) {
    scrape.status = "failed"
    if (error instanceof Error && error.message.includes("404")) {
      scrape.error = `Organization "${org}" not found. Please check the spelling and try again.`
    } else {
      scrape.error = error instanceof Error ? error.message : "Failed to scrape organization"
    }
    throw error
  }
}

async function scrapeRepository(scrapeId: string, repo: string, token?: string) {
  const githubClient = createGitHubClient(token)
  const scrape = scrapeStorage.get(scrapeId)
  if (!scrape) return

  try {
    const contributors = await githubClient.getRepoContributors(repo)

    if (!contributors || contributors.length === 0) {
      scrape.status = "failed"
      scrape.error = `No contributors found for repository "${repo}". Please check the repository name.`
      return
    }

    scrape.total = contributors.length

    for (let i = 0; i < contributors.length; i++) {
      const contributor = contributors[i]
      scrape.current = i + 1
      scrape.progress = Math.round(((i + 1) / contributors.length) * 100)
      scrape.currentUser = contributor.login

      try {
        const details = await githubClient.getUserDetails(contributor.login)

        scrape.contributors.push({
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
      }
    }

    scrape.status = "completed"
    scrape.completedAt = new Date()
    scrape.currentUser = undefined
  } catch (error) {
    scrape.status = "failed"
    if (error instanceof Error && error.message.includes("404")) {
      scrape.error = `Repository "${repo}" not found. Please check the spelling and try again.`
    } else {
      scrape.error = error instanceof Error ? error.message : "Failed to scrape repository"
    }
    throw error
  }
}
