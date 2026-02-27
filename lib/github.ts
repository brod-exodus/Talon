// GitHub API client with authentication for 5000 req/hour rate limit

export type BioContacts = {
  email?: string
  twitter?: string
  linkedin?: string
  website?: string
}

/**
 * Normalise any recognised LinkedIn pattern to a full canonical URL.
 *
 * Handles:
 *   https://www.linkedin.com/in/john-doe
 *   http://linkedin.com/in/john-doe
 *   www.linkedin.com/in/john-doe
 *   linkedin.com/in/john-doe
 *   /in/john-doe            (bare path, sometimes in the blog field)
 */
function normaliseLinkedIn(raw: string): string | null {
  // Already a full URL — strip trailing punctuation and return
  const fullUrl = raw.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/([A-Za-z0-9_%-]+)/i)
  if (fullUrl) return `https://linkedin.com/in/${fullUrl[1]}`

  // URL without scheme: linkedin.com/in/username or www.linkedin.com/in/username
  const noScheme = raw.match(/(?:^|[\s(])(?:www\.)?linkedin\.com\/in\/([A-Za-z0-9_%-]+)/i)
  if (noScheme) return `https://linkedin.com/in/${noScheme[1]}`

  // Bare path: /in/username (common in GitHub blog field)
  const barePath = raw.match(/(?:^|[\s(])\/in\/([A-Za-z0-9_%-]+)/i)
  if (barePath) return `https://linkedin.com/in/${barePath[1]}`

  return null
}

/**
 * Extract contact information from a free-text string (bio, blog field, etc.).
 * Finds: emails, Twitter/X handles, LinkedIn URLs (always stored as full https:// URL),
 * and other http/https URLs.
 */
export function extractContactsFromBio(text: string | null | undefined): BioContacts {
  const result: BioContacts = {}
  if (!text || typeof text !== "string" || !text.trim()) return result

  const s = text.trim()

  // Email
  const emailMatch = s.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/)
  if (emailMatch) result.email = emailMatch[0]

  // Twitter/X: @handle or twitter.com/handle or x.com/handle
  const twitterHandleMatch =
    s.match(/(?:^|[\s(])@([a-zA-Z0-9_]{1,15})(?=[\s)]|$)/)?.[1] ??
    s.match(/(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/i)?.[1]
  if (twitterHandleMatch) result.twitter = twitterHandleMatch

  // LinkedIn — try every recognised pattern and normalise to full URL
  const linkedIn = normaliseLinkedIn(s)
  if (linkedIn) result.linkedin = linkedIn

  // Website: first http(s) URL that isn't Twitter or LinkedIn
  const urlCandidates = s.match(/https?:\/\/[^\s)\]>"']+/gi) ?? []
  const websiteUrl = urlCandidates.find(
    (u) => !/twitter\.com|x\.com|linkedin\.com/i.test(u.replace(/[)\]>"']+$/, ""))
  )
  if (websiteUrl) result.website = websiteUrl.replace(/[)\]>"']+$/, "")

  return result
}

/** One entry from GET /users/{username}/social_accounts */
export interface SocialAccount {
  provider: string  // e.g. 'linkedin', 'twitter', 'facebook', 'instagram', …
  url: string
}

/**
 * Extract Twitter handle and LinkedIn canonical URL from a social_accounts array.
 * These come directly from the user's GitHub settings, so they should be treated
 * as higher-confidence than anything parsed out of a free-text bio or blog field.
 */
export function extractSocialContacts(accounts: SocialAccount[]): {
  twitter?: string
  linkedin?: string
} {
  const result: { twitter?: string; linkedin?: string } = {}

  const li = accounts.find((a) => a.provider === "linkedin")
  if (li?.url) {
    // normaliseLinkedIn handles any URL format; fall back to the raw URL if it
    // somehow doesn't match (shouldn't happen for well-formed LinkedIn URLs).
    result.linkedin = normaliseLinkedIn(li.url) ?? li.url
  }

  const tw = accounts.find((a) => a.provider === "twitter")
  if (tw?.url) {
    // Store just the handle (no @ prefix) to match how twitter_username is stored
    const handle = tw.url.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/i)?.[1]
    if (handle) result.twitter = handle
  }

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

  async getUserSocialAccounts(username: string): Promise<SocialAccount[]> {
    console.log("[v0] Getting social accounts for user:", username)
    try {
      const data = await this.fetch(`${this.baseUrl}/users/${username}/social_accounts`)
      return Array.isArray(data) ? data : []
    } catch (err) {
      // 404 or empty response is normal for users with no social accounts set
      console.warn(`[v0] Could not fetch social accounts for ${username}:`, err)
      return []
    }
  }

  async getRateLimit() {
    return await this.fetch(`${this.baseUrl}/rate_limit`)
  }
}

export const createGitHubClient = (token?: string) => new GitHubClient(token)

// Keep backward compatibility
export const githubClient = new GitHubClient()
