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
