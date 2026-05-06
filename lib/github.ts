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
function normaliseLinkedIn(raw: string | null | undefined): string | null {
  if (!raw) return null

  // Extract the username from any LinkedIn URL format
  const match = raw.match(/linkedin\.com\/in\/([^\/\s\?]+)/)
  if (match) return `https://www.linkedin.com/in/${match[1]}`

  // Handle bare /in/username or in/username format
  const bareMatch = raw.match(/^\/?in\/([^\/\s\?]+)/)
  if (bareMatch) return `https://www.linkedin.com/in/${bareMatch[1]}`

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
    s.match(/(?:^|[\s(])@([a-zA-Z0-9_]{1,15})(?=[\s),.;!?]|$)/)?.[1] ??
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

type GitHubRepositoryResponse = {
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

export type GitHubRateLimit = {
  resources: {
    core: {
      limit: number
      remaining: number
      reset: number
    }
  }
}

export type GitHubClientOptions = {
  maxRetries?: number
  requestTimeoutMs?: number
  maxRetryDelayMs?: number
  fetchImpl?: typeof fetch
}

type GitHubResponsePayload<T> = {
  data: T
  headers: Headers
}

type RetryDecision = {
  retryable: boolean
  delayMs: number
  reason: string
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_REQUEST_TIMEOUT_MS = 20000
const DEFAULT_MAX_RETRY_DELAY_MS = 30000

export class GitHubApiError extends Error {
  status?: number
  retryAfterMs?: number
  rateLimitResetAt?: Date
  responseBody?: string

  constructor(
    message: string,
    options: {
      status?: number
      retryAfterMs?: number
      rateLimitResetAt?: Date
      responseBody?: string
      cause?: unknown
    } = {}
  ) {
    super(message, { cause: options.cause })
    this.name = "GitHubApiError"
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    this.rateLimitResetAt = options.rateLimitResetAt
    this.responseBody = options.responseBody
  }
}

export function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000

  const dateMs = Date.parse(value)
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - now)

  return null
}

export function parseRateLimitResetMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null

  const resetSeconds = Number(value)
  if (!Number.isFinite(resetSeconds) || resetSeconds <= 0) return null

  return Math.max(0, resetSeconds * 1000 - now)
}

export function getGitHubRetryDecision(
  status: number,
  headers: Pick<Headers, "get">,
  body = "",
  attempt = 0,
  now = Date.now()
): RetryDecision {
  const retryAfterMs = parseRetryAfterMs(headers.get("retry-after"), now)
  const rateLimitResetMs = parseRateLimitResetMs(headers.get("x-ratelimit-reset"), now)
  const remaining = headers.get("x-ratelimit-remaining")
  const normalizedBody = body.toLowerCase()
  const isPrimaryRateLimit = (status === 403 || status === 429) && remaining === "0"
  const isSecondaryRateLimit =
    status === 403 &&
    (normalizedBody.includes("secondary rate limit") ||
      normalizedBody.includes("abuse detection") ||
      normalizedBody.includes("temporarily blocked"))

  if (retryAfterMs !== null) {
    return { retryable: true, delayMs: retryAfterMs, reason: "retry-after" }
  }

  if (isPrimaryRateLimit && rateLimitResetMs !== null) {
    return { retryable: true, delayMs: rateLimitResetMs, reason: "primary-rate-limit" }
  }

  if (isSecondaryRateLimit) {
    return { retryable: true, delayMs: Math.min(60000, 5000 * 2 ** attempt), reason: "secondary-rate-limit" }
  }

  if (status === 408 || status === 409 || status === 425 || status >= 500) {
    return { retryable: true, delayMs: Math.min(30000, 1000 * 2 ** attempt), reason: "transient-http" }
  }

  return { retryable: false, delayMs: 0, reason: "terminal-http" }
}

class GitHubClient {
  private token: string
  private baseUrl = "https://api.github.com"
  private maxRetries: number
  private requestTimeoutMs: number
  private maxRetryDelayMs: number
  private fetchImpl: typeof fetch

  constructor(token?: string, options: GitHubClientOptions = {}) {
    this.token = token || process.env.GITHUB_TOKEN || ""
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  private headers(): HeadersInit {
    return {
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      Accept: "application/vnd.github.v3+json",
    }
  }

  private repoPath(repo: string): string {
    return repo.split("/").map(encodeURIComponent).join("/")
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  private requestErrorMessage(status: number, statusText: string, body: string): string {
    const cleanedBody = body.trim().replace(/\s+/g, " ")
    const detail = cleanedBody ? ` - ${cleanedBody.slice(0, 500)}` : ""
    return `GitHub API error: ${status} ${statusText}${detail}`
  }

  private async fetchJson<T = unknown>(url: string): Promise<GitHubResponsePayload<T>> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs)

      try {
        const response = await this.fetchImpl(url, {
          headers: this.headers(),
          redirect: "follow",
          signal: controller.signal,
        })

        if (response.status === 204) return { data: [] as T, headers: response.headers }

        if (!response.ok) {
          const body = await response.text()
          const decision = getGitHubRetryDecision(response.status, response.headers, body, attempt)
          const canRetry = attempt < this.maxRetries && decision.retryable && decision.delayMs <= this.maxRetryDelayMs

          if (canRetry) {
            await this.sleep(Math.max(decision.delayMs, 1000 * 2 ** attempt))
            continue
          }

          const resetMs = parseRateLimitResetMs(response.headers.get("x-ratelimit-reset"))
          const retryAfterMs = decision.retryable ? decision.delayMs : resetMs ?? undefined
          const resetAt = resetMs !== null ? new Date(Date.now() + resetMs) : undefined
          throw new GitHubApiError(this.requestErrorMessage(response.status, response.statusText, body), {
            status: response.status,
            retryAfterMs,
            rateLimitResetAt: resetAt,
            responseBody: body,
          })
        }

        const contentLength = response.headers.get("content-length")
        if (contentLength === "0") return { data: [] as T, headers: response.headers }

        const text = await response.text()
        if (!text.trim()) return { data: [] as T, headers: response.headers }
        return { data: JSON.parse(text) as T, headers: response.headers }
      } catch (error) {
        if (error instanceof GitHubApiError) throw error

        const isTimeout = error instanceof Error && error.name === "AbortError"
        lastError =
          error instanceof Error
            ? new GitHubApiError(
                isTimeout
                  ? `GitHub request timed out after ${this.requestTimeoutMs}ms`
                  : `GitHub request failed: ${error.message}`,
                { cause: error }
              )
            : new GitHubApiError("Unknown GitHub request error")
        if (attempt >= this.maxRetries) break
        await this.sleep(1000 * 2 ** attempt)
      } finally {
        clearTimeout(timeout)
      }
    }

    throw lastError ?? new GitHubApiError("GitHub request failed")
  }

  private async fetch<T = unknown>(url: string): Promise<T> {
    const { data } = await this.fetchJson<T>(url)
    return data
  }

  async getOrgRepos(org: string): Promise<Repository[]> {
    console.log("[v0] Getting repos for org:", org)
    const all: Repository[] = []
    let page = 1
    while (true) {
      const { data: batch, headers } = await this.fetchJson<GitHubRepositoryResponse[]>(
        `${this.baseUrl}/orgs/${encodeURIComponent(org)}/repos?per_page=100&page=${page}`
      )
      if (!batch || batch.length === 0) break
      all.push(...batch.map((repo) => ({
        full_name: repo.full_name,
        fork: repo.fork,
        archived: repo.archived,
      })))
      if (batch.length < 100 || !headers.get("link")?.includes('rel="next"')) break
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
      const { data: batch, headers } = await this.fetchJson<Contributor[]>(
        `${this.baseUrl}/repos/${this.repoPath(repo)}/contributors?per_page=100&page=${page}`
      )
      if (!batch || batch.length === 0) break
      all.push(...batch)
      if (batch.length < 100 || !headers.get("link")?.includes('rel="next"')) break
      page++
    }
    console.log("[v0] Found contributors:", all.length)
    return all
  }

  async getUserDetails(username: string): Promise<Contributor> {
    console.log("[v0] Getting details for user:", username)
    return await this.fetch(`${this.baseUrl}/users/${encodeURIComponent(username)}`)
  }

  async getUserSocialAccounts(username: string): Promise<SocialAccount[]> {
    console.log("[v0] Getting social accounts for user:", username)
    try {
      const data = await this.fetch(`${this.baseUrl}/users/${encodeURIComponent(username)}/social_accounts`)
      return Array.isArray(data) ? data : []
    } catch (err) {
      if (err instanceof GitHubApiError && err.status !== 404) throw err
      // 404 or empty response is normal for users with no social accounts set
      console.warn(`[v0] Could not fetch social accounts for ${username}:`, err)
      return []
    }
  }

  async getRateLimit(): Promise<GitHubRateLimit> {
    return await this.fetch<GitHubRateLimit>(`${this.baseUrl}/rate_limit`)
  }
}

export const createGitHubClient = (token?: string, options?: GitHubClientOptions) => new GitHubClient(token, options)

// Keep backward compatibility
export const githubClient = new GitHubClient()
