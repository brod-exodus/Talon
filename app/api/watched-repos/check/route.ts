import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"
import { createGitHubClient, extractContactsFromBio } from "@/lib/github"
import { upsertContributor } from "@/lib/db"

type WatchedRepo = {
  id: string
  repo: string
  interval_hours: number
  active: boolean
  last_checked_at: string | null
  created_at: string
}

async function sendSlackNotification(
  webhookUrl: string,
  repo: string,
  newContributors: Array<{ username: string; name: string | null; avatar: string | null }>
): Promise<void> {
  const lines = newContributors.map(
    (c) => `• *${c.name ?? c.username}* (<https://github.com/${c.username}|@${c.username}>)`
  )
  const text =
    `🆕 *${newContributors.length} new contributor${newContributors.length > 1 ? "s" : ""}* detected in *${repo}*:\n` +
    lines.join("\n")

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    console.error("[watched-repos/check] Slack notification failed:", res.status, await res.text())
  }
}

export async function POST() {
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL
  const githubToken = process.env.GITHUB_TOKEN

  const now = new Date()

  try {
    // Fetch all active watched repos that are due for a check
    const { data: allWatched, error: fetchError } = await supabase
      .from("watched_repos")
      .select("*")
      .eq("active", true)
    if (fetchError) throw fetchError

    const dueRepos: WatchedRepo[] = (allWatched ?? []).filter((row) => {
      if (!row.last_checked_at) return true
      const nextCheck = new Date(
        new Date(row.last_checked_at).getTime() + row.interval_hours * 60 * 60 * 1000
      )
      return now >= nextCheck
    })

    console.log(`[watched-repos/check] ${dueRepos.length} repo(s) due for check out of ${(allWatched ?? []).length}`)

    const results: Array<{ repo: string; newContributors: number; error?: string }> = []

    for (const watched of dueRepos) {
      try {
        const githubClient = createGitHubClient(githubToken)
        const contributors = await githubClient.getRepoContributors(watched.repo)

        if (!contributors || contributors.length === 0) {
          await supabase
            .from("watched_repos")
            .update({ last_checked_at: now.toISOString() })
            .eq("id", watched.id)
          results.push({ repo: watched.repo, newContributors: 0 })
          continue
        }

        // Fetch existing tracked contributor logins for this watched repo
        const { data: existingLinks } = await supabase
          .from("watched_repo_contributors")
          .select("github_username")
          .eq("watched_repo_id", watched.id)
        const knownUsernames = new Set((existingLinks ?? []).map((r) => r.github_username))

        const newContributors: Array<{ username: string; name: string | null; avatar: string | null }> = []

        for (const contributor of contributors) {
          if (knownUsernames.has(contributor.login)) continue

          // New contributor — fetch details, upsert into contributors table
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
            const contacts = {
              email: structured.email ?? bioContacts.email ?? null,
              twitter: structured.twitter ?? bioContacts.twitter ?? null,
              linkedin: structured.linkedin ?? bioContacts.linkedin ?? null,
              website: structured.website ?? bioContacts.website ?? null,
            }

            await upsertContributor({
              github_username: contributor.login,
              name: details.name ?? null,
              avatar_url: details.avatar_url ?? null,
              bio: details.bio ?? null,
              location: details.location ?? null,
              company: details.company ?? null,
              email: contacts.email,
              twitter: contacts.twitter,
              linkedin: contacts.linkedin,
              website: contacts.website,
            })

            // Record in watched_repo_contributors so we don't flag them again
            await supabase.from("watched_repo_contributors").insert({
              watched_repo_id: watched.id,
              github_username: contributor.login,
              first_seen_at: now.toISOString(),
            })

            newContributors.push({
              username: contributor.login,
              name: details.name ?? null,
              avatar: details.avatar_url ?? null,
            })
          } catch (err) {
            console.error(`[watched-repos/check] Failed to process ${contributor.login}:`, err)
          }
        }

        // Send Slack notification if there are new contributors and webhook is configured
        if (newContributors.length > 0 && slackWebhookUrl) {
          await sendSlackNotification(slackWebhookUrl, watched.repo, newContributors)
        }

        // Update last_checked_at
        await supabase
          .from("watched_repos")
          .update({ last_checked_at: now.toISOString() })
          .eq("id", watched.id)

        results.push({ repo: watched.repo, newContributors: newContributors.length })
      } catch (err) {
        console.error(`[watched-repos/check] Failed to check ${watched.repo}:`, err)
        results.push({
          repo: watched.repo,
          newContributors: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        })
      }
    }

    return NextResponse.json({ checked: dueRepos.length, results })
  } catch (error) {
    console.error("[watched-repos/check] Fatal error:", error)
    return NextResponse.json({ error: "Failed to run check" }, { status: 500 })
  }
}
