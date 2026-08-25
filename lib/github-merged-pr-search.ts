export type GitHubSearchScope = "repository" | "organization"

const GITHUB_USERNAME_PATTERN = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/
const REPOSITORY_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/

function normalizeTarget(target: string, type: GitHubSearchScope): string | null {
  let value = target.trim()
  if (!value) return null

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      if (url.hostname.toLowerCase() !== "github.com") return null
      value = url.pathname.replace(/^\/+|\/+$/g, "")
    } catch {
      return null
    }
  }

  value = value.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "")
  const parts = value.split("/")
  if (type === "organization") {
    if (parts.length !== 1 || !GITHUB_USERNAME_PATTERN.test(parts[0])) return null
    return parts[0]
  }
  if (
    parts.length !== 2
    || !GITHUB_USERNAME_PATTERN.test(parts[0])
    || !REPOSITORY_NAME_PATTERN.test(parts[1])
  ) return null
  return `${parts[0]}/${parts[1]}`
}

export function buildMergedPullRequestsUrl({
  target,
  type,
  username,
}: {
  target: string | null | undefined
  type: string | null | undefined
  username: string | null | undefined
}): string | null {
  const normalizedUsername = username?.trim() ?? ""
  if (!GITHUB_USERNAME_PATTERN.test(normalizedUsername)) return null
  if (type !== "repository" && type !== "organization") return null

  const normalizedTarget = normalizeTarget(target ?? "", type)
  if (!normalizedTarget) return null
  const scope = type === "repository" ? `repo:${normalizedTarget}` : `org:${normalizedTarget}`
  const query = `${scope} is:pr is:merged author:${normalizedUsername}`
  const parameters = new URLSearchParams({ q: query, type: "pullrequests" })
  return `https://github.com/search?${parameters.toString()}`
}
