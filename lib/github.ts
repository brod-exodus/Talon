// GitHub API client with authentication for 5000 req/hour rate limit

export type BioContacts = {
  email?: string
  twitter?: string
  linkedin?: string
  website?: string
}

/**
 * Extract contact information from a GitHub bio string using regex.
 * Finds: emails, Twitter/X handles (@user or twitter.com/user), LinkedIn (linkedin.com/in/user),
 * and other http/https URLs (excluding Twitter and LinkedIn).
 */
export function extractContactsFromBio(bio: string | null | undefined): BioContacts {
  const result: BioContacts = {}
  if (!bio || typeof bio !== "string" || !bio.trim()) return result

  const s = bio.trim()

  // Email: common pattern
  const emailMatch = s.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/)
  if (emailMatch) result.email = emailMatch[0]

  // Twitter/X: @handle or twitter.com/handle or x.com/handle (handle = username without @)
  const twitterHandleMatch =
    s.match(/(?:^|[\s(])@([a-zA-Z0-9_]{1,15})(?=[\s)]|$)/)?.[1] ??
    s.match(/(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i)?.[1]
  if (twitterHandleMatch) result.twitter = twitterHandleMatch

  // LinkedIn: linkedin.com/in/username
  const linkedinMatch = s.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i)?.[1]
  if (linkedinMatch) result.linkedin = linkedinMatch

  // Website: first http(s) URL that is not Twitter or LinkedIn
  const urlCandidates = s.match(/https?:\/\/[^\s)\]>"']+/gi) ?? []
  const websiteUrl = urlCandidates.find(
    (u) => !/twitter\.com|x\.com|linkedin\.com/i.test(u.replace(/[)\]>"']+$/, ""))
  )
  if (websiteUrl) result.website = websiteUrl.replace(/[)\]>"']+$/, "")

  return result
}

export interface Contributor {
  id: number
  login: string
  avatar_url: string
  html_url: string
  contributions: number
  name?: string
  email?: string
  twitter_username?: string
  blog?: string
  bio?: string
  location?: string
  company?: string
}

export interface Repository {
  full_name: string
  fork: boolean
  archived: boolean
}

export interface ScrapeProgress {
  current: number
  total: number
  currentUser: string
  contributors: Contributor[]
}

class GitHubClient {
  private token: string
  private baseUrl = "https://api.github.com"

  constructor(token?: string) {
    this.token = token || process.env.GITHUB_TOKEN || ""
  }

  private async fetch(url: string) {
    console.log("[v0] Fetching:", url)

    const response = await fetch(url, {
      headers: {
        Authorization: `token ${this.token}`,
        Accept: "application/vnd.github.v3+json",
      },
      redirect: "follow", // Added redirect: 'follow' to handle 301 redirects when repos are moved/renamed
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error("[v0] GitHub API error:", response.status, errorBody)
      throw new Error(`GitHub API error: ${response.statusText} - ${errorBody}`)
    }

    if (response.status === 204) {
      console.log("[v0] 204 No Content - returning empty array")
      return []
    }

    const contentLength = response.headers.get("content-length")
    if (contentLength === "0") {
      console.log("[v0] Empty response body - returning empty array")
      return []
    }

    try {
      const text = await response.text()
      if (!text || text.trim() === "") {
        console.log("[v0] Empty text response - returning empty array")
        return []
      }
      return JSON.parse(text)
    } catch (error) {
      console.error("[v0] JSON parse error:", error)
      console.log("[v0] Returning empty array due to parse error")
      return []
    }
  }

  async getOrgRepos(org: string): Promise<Repository[]> {
    console.log("[v0] Getting repos for org:", org)
    const all: Repository[] = []
    let page = 1
    while (true) {
      const batch = await this.fetch(`${this.baseUrl}/orgs/${org}/repos?per_page=100&page=${page}`)
      if (!batch || batch.length === 0) break
      all.push(...batch.map((repo: any) => ({
        full_name: repo.full_name,
        fork: repo.fork,
        archived: repo.archived,
      })))
      if (batch.length < 100) break
      page++
    }
    console.log("[v0] Found repos:", all.length)
    return all
  }

  async getRepoContributors(repo: string): Promise<Contributor[]> {
    console.log("[v0] Getting contributors for repo:", repo)
    const all: Contributor[] = []
    let page = 1
    while (true) {
      const batch = await this.fetch(`${this.baseUrl}/repos/${repo}/contributors?per_page=100&page=${page}`)
      if (!batch || batch.length === 0) break
      all.push(...batch)
      if (batch.length < 100) break
      page++
    }
    console.log("[v0] Found contributors:", all.length)
    return all
  }

  async getUserDetails(username: string): Promise<Contributor> {
    console.log("[v0] Getting details for user:", username)
    return await this.fetch(`${this.baseUrl}/users/${username}`)
  }

  async getRateLimit() {
    return await this.fetch(`${this.baseUrl}/rate_limit`)
  }
}

export const createGitHubClient = (token?: string) => new GitHubClient(token)

// Keep backward compatibility
export const githubClient = new GitHubClient()
