import { type NextRequest, NextResponse } from "next/server"
import { createGitHubClient, extractContactsFromBio } from "@/lib/github"
import { getScrape, failScrape, deleteScrape, updateScrapeProgress, completeScrape } from "@/lib/db"

/** Merge API contacts with bio-extracted contacts; prefer structured (API) when both exist. */
function mergeContacts(
  structured: { email?: string; twitter?: string; linkedin?: string; website?: string },
  fromBio: ReturnType<typeof extractContactsFromBio>
) {
  return {
    email: structured.email ?? fromBio.email,
    twitter: structured.twitter ?? fromBio.twitter,
    linkedin: structured.linkedin ?? fromBio.linkedin,
    website: structured.website ?? fromBio.website,
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: scrapeId } = await params
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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: scrapeId } = await params
    const { type, target, token } = await request.json()

    console.log("[v0] Starting scrape:", { scrapeId, type, target })

    if (type === "organization") {
      scrapeOrganization(scrapeId, target, token).catch((error) => {
        console.error("[v0] Organization scrape failed – full error:", error)
        failScrape(scrapeId, error instanceof Error ? error.message : "Unknown error").catch(console.error)
      })
    } else if (type === "repository") {
      scrapeRepository(scrapeId, target, token).catch((error) => {
        console.error("[v0] Repository scrape failed – full error:", error)
        failScrape(scrapeId, error instanceof Error ? error.message : "Unknown error").catch(console.error)
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Process scrape error – full error:", error)
    const { id: scrapeId } = await params
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

async function scrapeOrganization(scrapeId: string, org: string, token?: string) {
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
      await updateScrapeProgress(scrapeId, {
        current: i + 1,
        total: repos.length,
        progress: Math.round(((i + 1) / repos.length) * 100),
        current_user_login: undefined,
      })

      try {
        const contributors = await githubClient.getRepoContributors(repo.full_name)

        for (const contributor of contributors) {
          const existing = contributorMap.get(contributor.login)
          if (existing) {
            existing.contributions += contributor.contributions
          } else {
            try {
              await updateScrapeProgress(scrapeId, {
                current: i + 1,
                total: repos.length,
                progress: Math.round(((i + 1) / repos.length) * 100),
                current_user_login: contributor.login,
              })
              const details = await githubClient.getUserDetails(contributor.login)
              const bioContacts = extractContactsFromBio(details.bio)
              const structured = {
                email: details.email || undefined,
                twitter: details.twitter_username || undefined,
                linkedin: undefined as string | undefined,
                website:
                  details.blog && !details.blog.includes("linkedin.com") ? details.blog : undefined,
              }
              contributorMap.set(contributor.login, {
                username: contributor.login,
                name: details.name || contributor.login,
                avatar: details.avatar_url,
                contributions: contributor.contributions,
                bio: details.bio || undefined,
                location: details.location || undefined,
                company: details.company || undefined,
                contacts: mergeContacts(structured, bioContacts),
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

    await completeScrape(scrapeId, filteredContributors)
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

async function scrapeRepository(scrapeId: string, repo: string, token?: string) {
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

    const list: Array<{
      username: string
      name: string
      avatar: string
      contributions: number
      bio?: string
      location?: string
      company?: string
      contacts: { email?: string; twitter?: string; linkedin?: string; website?: string }
    }> = []

    for (let i = 0; i < contributors.length; i++) {
      const contributor = contributors[i]
      await updateScrapeProgress(scrapeId, {
        current: i + 1,
        total: contributors.length,
        progress: Math.round(((i + 1) / contributors.length) * 100),
        current_user_login: contributor.login,
      })

      try {
        const details = await githubClient.getUserDetails(contributor.login)
        const bioContacts = extractContactsFromBio(details.bio)
        const structured = {
          email: details.email || undefined,
          twitter: details.twitter_username || undefined,
          linkedin: undefined as string | undefined,
          website:
            details.blog && !details.blog.includes("linkedin.com") ? details.blog : undefined,
        }
        list.push({
          username: contributor.login,
          name: details.name || contributor.login,
          avatar: details.avatar_url,
          contributions: contributor.contributions,
          bio: details.bio || undefined,
          location: details.location || undefined,
          company: details.company || undefined,
          contacts: mergeContacts(structured, bioContacts),
        })
      } catch (error) {
        console.error(`[v0] Failed to get details for ${contributor.login}:`, error)
      }
    }

    await completeScrape(scrapeId, list)
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
