export type ScrapeFailureCode =
  | "github_rate_limited"
  | "github_credentials_invalid"
  | "github_target_unavailable"
  | "github_permission_denied"
  | "github_unavailable"
  | "github_network_error"
  | "processing_error"

export type ScrapeFailureDiagnostic = {
  code: ScrapeFailureCode
  summary: string
  guidance: string
}

type FailureContext = {
  message?: string | null
  metadata?: Record<string, unknown> | null
}

function contains(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message))
}

export function classifyScrapeFailure({ message, metadata }: FailureContext): ScrapeFailureDiagnostic {
  const normalized = (message ?? "").toLowerCase()
  const cooldownReason = typeof metadata?.githubCooldownReason === "string"
    ? metadata.githubCooldownReason
    : ""

  if (cooldownReason || contains(normalized, [/rate.?limit/, /retry.after/, /api rate limit exceeded/])) {
    return {
      code: "github_rate_limited",
      summary: "GitHub rate limiting paused this scrape.",
      guidance: "Talon will resume automatically after GitHub's cooldown.",
    }
  }
  if (contains(normalized, [/\b401\b/, /bad credentials/, /requires authentication/, /token.*invalid/])) {
    return {
      code: "github_credentials_invalid",
      summary: "GitHub rejected Talon's server credential.",
      guidance: "Validate GITHUB_TOKEN in the production environment, then retry the scrape.",
    }
  }
  if (contains(normalized, [/\b404\b/, /not found/, /repository.*unavailable/, /organization.*unavailable/])) {
    return {
      code: "github_target_unavailable",
      summary: "GitHub could not find or expose this target.",
      guidance: "Confirm the target exists and that the server token can access it.",
    }
  }
  if (contains(normalized, [/\b403\b/, /resource not accessible/, /permission denied/, /forbidden/])) {
    return {
      code: "github_permission_denied",
      summary: "GitHub denied access to this target.",
      guidance: "Confirm the server token has permission to read the repository or organization.",
    }
  }
  if (contains(normalized, [/\b50[0-9]\b/, /github.*(unavailable|service error|server error)/])) {
    return {
      code: "github_unavailable",
      summary: "GitHub was temporarily unavailable.",
      guidance: "Retry after GitHub recovers; Talon's automatic retries may resolve this first.",
    }
  }
  if (contains(normalized, [/timed out/, /network/, /fetch failed/, /connection/])) {
    return {
      code: "github_network_error",
      summary: "Talon could not reach GitHub reliably.",
      guidance: "Retry the scrape; repeated failures may indicate a provider or deployment network issue.",
    }
  }
  return {
    code: "processing_error",
    summary: "Talon could not finish processing this scrape.",
    guidance: "Retry once. If it fails again, use the request ID in server logs to investigate.",
  }
}
