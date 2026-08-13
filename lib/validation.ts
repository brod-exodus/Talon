export type ScrapeType = "organization" | "repository"
export type ProjectOutreachStatus =
  | "not_contacted"
  | "contacted"
  | "replied"
  | "interested"
  | "interviewing"
  | "rejected"
  | "archived"

const NAME_MAX = 120
const NOTES_MAX = 5000
const STATUS_MAX = 80
const OWNER_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const OWNER_RE = /^[A-Za-z0-9_.-]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SCRAPE_ID_RE = /^[A-Za-z0-9_-]{6,120}$/
const GITHUB_USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const GITHUB_TOKEN_RE = /^(ghp_|github_pat_)[A-Za-z0-9_]+$/
const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{24,128}$/
const PROJECT_OUTREACH_STATUSES = new Set<ProjectOutreachStatus>([
  "not_contacted",
  "contacted",
  "replied",
  "interested",
  "interviewing",
  "rejected",
  "archived",
])

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return isRecord(body) ? body : null
  } catch {
    return null
  }
}

export function parseScrapeType(value: unknown): ScrapeType | null {
  return value === "organization" || value === "repository" ? value : null
}

function githubPathSegments(value: string): string[] | null {
  let target = value.trim()
  if (!target) return null

  if (/^https?:\/\//i.test(target) || /^github\.com\//i.test(target) || /^www\.github\.com\//i.test(target)) {
    try {
      const url = new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`)
      if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null
      target = url.pathname
    } catch {
      return null
    }
  }

  return target
    .split(/[?#]/, 1)[0]
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
}

export function normalizeGitHubRepositoryTarget(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048) return null

  const segments = githubPathSegments(trimmed)
  if (!segments || segments.length < 2) return null

  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/i, "")
  const normalized = `${owner}/${repo}`
  return normalized.length <= 160 && OWNER_REPO_RE.test(normalized) ? normalized : null
}

export function normalizeGitHubOwnerTarget(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048) return null

  const segments = githubPathSegments(trimmed)
  if (!segments || segments.length !== 1) return null

  const owner = segments[0]
  return owner.length <= 160 && OWNER_RE.test(owner) ? owner : null
}

export function normalizeScrapeTarget(type: ScrapeType, value: unknown): string | null {
  if (type === "repository") return normalizeGitHubRepositoryTarget(value)
  return normalizeGitHubOwnerTarget(value)
}

export function normalizeRepo(value: unknown): string | null {
  return normalizeGitHubRepositoryTarget(value)
}

export function normalizeUuid(value: unknown): string | null {
  if (typeof value !== "string") return null
  const id = value.trim()
  return UUID_RE.test(id) ? id : null
}

export function normalizeScrapeId(value: unknown): string | null {
  if (typeof value !== "string") return null
  const id = value.trim()
  return SCRAPE_ID_RE.test(id) ? id : null
}

export function normalizeShareToken(value: unknown): string | null {
  if (typeof value !== "string") return null
  const token = value.trim()
  return SHARE_TOKEN_RE.test(token) ? token : null
}

export function normalizeShareId(value: unknown): string | null {
  return normalizeUuid(value)
}

export function normalizeGithubUsername(value: unknown): string | null {
  if (typeof value !== "string") return null
  const username = value.trim()
  return GITHUB_USERNAME_RE.test(username) ? username : null
}

export function normalizeGithubToken(value: unknown): string | null {
  if (typeof value !== "string") return null
  const token = value.trim()
  return token.length <= 300 && GITHUB_TOKEN_RE.test(token) ? token : null
}

export function normalizeSlackWebhookUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (raw.length > 2048) return null
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && url.hostname === "hooks.slack.com" && url.pathname.startsWith("/services/")
      ? url.toString()
      : null
  } catch {
    return null
  }
}

export function normalizeOptionalIsoDate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value == null || value === "") return null
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined
  const date = new Date(`${trimmed}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed ? undefined : trimmed
}

export function parseMinContributions(value: unknown): number {
  const parsed = Math.floor(Number(value) || 1)
  return Math.min(100000, Math.max(1, parsed))
}

export function parseIntervalHours(value: unknown): number | null {
  const parsed = Math.floor(Number(value))
  return [1, 6, 12, 24, 48].includes(parsed) ? parsed : null
}

export function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const name = value.trim()
  return name.length > 0 && name.length <= NAME_MAX ? name : null
}

export function normalizeRequiredString(value: unknown, maxLength = 160): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null
}

export function normalizeOptionalNotes(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value == null) return null
  if (typeof value !== "string") return undefined
  return value.length <= NOTES_MAX ? value : undefined
}

export function normalizeOptionalStatus(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value == null) return null
  if (typeof value !== "string") return undefined
  const status = value.trim()
  return status.length <= STATUS_MAX ? status : undefined
}

export function normalizeProjectOutreachStatus(value: unknown): ProjectOutreachStatus | undefined {
  if (typeof value !== "string") return undefined
  const status = value.trim()
  return PROJECT_OUTREACH_STATUSES.has(status as ProjectOutreachStatus)
    ? (status as ProjectOutreachStatus)
    : undefined
}
