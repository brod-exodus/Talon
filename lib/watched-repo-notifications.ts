import "server-only"
import { supabaseAdmin } from "@/lib/supabase"
import { normalizeSlackWebhookUrl } from "@/lib/validation"

const MAX_SLACK_CONTRIBUTORS = 50

export type WatchedRepoNotificationOutcome =
  | "sent"
  | "not_configured"
  | "not_needed"
  | "invalid_configuration"

export async function deliverWatchedRepoNotification(input: {
  watchedRepoId: string
  scrapeId: string
  teamId: string
  timeoutMs?: number
}): Promise<WatchedRepoNotificationOutcome> {
  const configuredWebhook = process.env.SLACK_WEBHOOK_URL
  if (!configuredWebhook) return "not_configured"
  const webhookUrl = normalizeSlackWebhookUrl(configuredWebhook)
  if (!webhookUrl) return "invalid_configuration"

  const [{ data: watched, error: watchedError }, { data: links, error: linksError }] = await Promise.all([
    supabaseAdmin
      .from("watched_repos")
      .select("repo")
      .eq("id", input.watchedRepoId)
      .eq("team_id", input.teamId)
      .single(),
    supabaseAdmin
      .from("watched_repo_contributors")
      .select("github_username")
      .eq("watched_repo_id", input.watchedRepoId)
      .eq("team_id", input.teamId)
      .eq("detected_scrape_id", input.scrapeId),
  ])
  if (watchedError) throw watchedError
  if (!watched) throw new Error("Watched repository not found")
  if (linksError) throw linksError

  const usernames = (links ?? []).map((link) => link.github_username)
  if (!usernames.length) return "not_needed"

  const { data: contributors, error: contributorsError } = await supabaseAdmin
    .from("contributors")
    .select("github_username, name")
    .eq("team_id", input.teamId)
    .in("github_username", usernames.slice(0, MAX_SLACK_CONTRIBUTORS))
  if (contributorsError) throw contributorsError

  const contributorMap = new Map((contributors ?? []).map((contributor) => [contributor.github_username, contributor]))
  const lines = usernames.slice(0, MAX_SLACK_CONTRIBUTORS).map((username) => {
    const contributor = contributorMap.get(username)
    return `• *${contributor?.name ?? username}* (<https://github.com/${username}|@${username}>)`
  })
  if (usernames.length > MAX_SLACK_CONTRIBUTORS) {
    lines.push(`• …and ${usernames.length - MAX_SLACK_CONTRIBUTORS} more`)
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text:
        `🆕 *${usernames.length} new contributor${usernames.length === 1 ? "" : "s"}* ` +
        `detected in *${watched.repo}*:\n${lines.join("\n")}`,
    }),
    signal: AbortSignal.timeout(Math.max(250, input.timeoutMs ?? 5000)),
  })
  if (!response.ok) throw new Error(`Slack notification returned HTTP ${response.status}`)
  return "sent"
}
