// GitHub API client with authentication for 5000 req/hour rate limit

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

export interface ScrapeProgress {
  current: number
  total: number
  currentUser: string
  contributors: Contributor[]
}

export interface RateLimitInfo {
  limit: number
  remaining: number
  reset: number // Unix timestamp
  resetDate: Date
}

class GitHubClient {
  private token: string
  private baseUrl = "https://api.github.com"
  private rateLimitCache: RateLimitInfo | null = null
  private lastRateLimitCheck = 0

  constructor(token?: string) {
    this.token = token || process.env.GITHUB_TOKEN || ""
  }

  private async checkRateLimit(): Promise<void> {
    const now = Date.now()

    // Check rate limit every 10 requests or if cache is stale (>1 min)
    if (this.rateLimitCache && now - this.lastRateLimitCheck < 60000) {
      // If we have less than 100 requests remaining, check again
      if (this.rateLimitCache.remaining < 100) {
        await this.updateRateLimit()
      }
    } else {
      await this.updateRateLimit()
    }

    // If rate limit exceeded, wait until reset
    if (this.rateLimitCache && this.rateLimitCache.remaining < 10) {
      const waitTime = this.rateLimitCache.reset * 1000 - now
      if (waitTime > 0) {
        console.log(
          `[v0] Rate limit nearly exceeded (${this.rateLimitCache.remaining} remaining). Waiting ${Math.ceil(waitTime / 1000)}s until reset...`,
        )
        await new Promise((resolve) => setTimeout(resolve, waitTime + 1000)) // Add 1s buffer
        await this.updateRateLimit() // Refresh after waiting
      }
    }
  }

  private async updateRateLimit(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/rate_limit`, {
        headers: {
          Authorization: `token ${this.token}`,
          Accept: "application/vnd.github.v3+json",
        },
      })

      if (response.ok) {
        const data = await response.json()
        const core = data.resources.core
        this.rateLimitCache = {
          limit: core.limit,
          remaining: core.remaining,
          reset: core.reset,
          resetDate: new Date(core.reset * 1000),
        }
        this.lastRateLimitCheck = Date.now()
        console.log(
          `[v0] Rate limit: ${this.rateLimitCache.remaining}/${this.rateLimitCache.limit} remaining (resets at ${this.rateLimitCache.resetDate.toLocaleTimeString()})`,
        )
      }
    } catch (error) {
      console.error("[v0] Failed to check rate limit:", error)
    }
  }

  async getRateLimitInfo(): Promise<RateLimitInfo | null> {
    await this.updateRateLimit()
    return this.rateLimitCache
  }

  private async fetch(url: string) {
    await this.checkRateLimit()

    console.log("[v0] Fetching:", url)

    const response = await fetch(url, {
      headers: {
        Authorization: `token ${this.token}`,
        Accept: "application/vnd.github.v3+json",
      },
      redirect: "follow",
    })

    if (response.status === 429) {
      const resetTime = response.headers.get("x-ratelimit-reset")
      if (resetTime) {
        const waitTime = Number.parseInt(resetTime) * 1000 - Date.now()
        console.log(`[v0] Rate limit exceeded. Waiting ${Math.ceil(waitTime / 1000)}s...`)
        await new Promise((resolve) => setTimeout(resolve, waitTime + 1000))
        // Retry the request after waiting
        return this.fetch(url)
      }
    }

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

  async getOrgRepos(org: string): Promise<string[]> {
    console.log("[v0] Getting repos for org:", org)
    const repos = await this.fetch(`${this.baseUrl}/orgs/${org}/repos?per_page=100`)
    console.log("[v0] Found repos:", repos.length)
    return repos.map((repo: any) => repo.full_name)
  }

  async getRepoContributors(repo: string): Promise<Contributor[]> {
    console.log("[v0] Getting contributors for repo:", repo)
    const contributors = await this.fetch(`${this.baseUrl}/repos/${repo}/contributors?per_page=100`)
    console.log("[v0] Found contributors:", contributors.length)
    return contributors
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
