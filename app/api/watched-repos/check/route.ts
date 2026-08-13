import { type NextRequest, NextResponse } from "next/server"
import { hasCronSecret } from "@/lib/auth"
import { recordAuditEvent } from "@/lib/audit"
import { recordActivityEvent } from "@/lib/activity"
import { requirePermission } from "@/lib/permissions"
import { supabaseAdmin } from "@/lib/supabase"
import { createGitHubClient, extractContactsFromBio, extractSocialContacts } from "@/lib/github"
import { upsertContributor } from "@/lib/db"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { finishSystemRun, startSystemRun } from "@/lib/system-runs"
import { getRequestId } from "@/lib/request-id"
import { logError, logInfo } from "@/lib/logger"

type WatchedRepo = {
  id: string
  team_id: string
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
    throw new Error(`Slack notification returned HTTP ${res.status}`)
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  const isCronRequest = hasCronSecret(request)
  let requestTeamId: string | null = null
  let requestTeamSlug: string | null = null
  let requestActorEmail: string | null = null
  if (!isCronRequest) {
    const authError = await requirePermission(request, "write")
    if (authError) return authError
    try {
      const team = await resolveTeamContext(request)
      requestTeamId = team.teamId
      requestTeamSlug = team.teamSlug
      requestActorEmail = team.email ?? null
    } catch (error) {
      return teamContextError(error)
    }
  }

  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL
  const githubToken = process.env.GITHUB_TOKEN

  const now = new Date()
  const systemRunId = await startSystemRun("watched_repos", {
    trigger: isCronRequest ? "cron" : "manual",
    teamSlug: requestTeamSlug,
  }, requestId)

  try {
    // Fetch all active watched repos that are due for a check
    const { data: allWatched, error: fetchError } = await supabaseAdmin
      .from("watched_repos")
      .select("*")
      .eq("active", true)
    if (fetchError) throw fetchError

    const scopedWatched = requestTeamId
      ? (allWatched ?? []).filter((row) => row.team_id === requestTeamId)
      : (allWatched ?? [])
    const dueRepos: WatchedRepo[] = isCronRequest ? scopedWatched.filter((row) => {
      if (!row.last_checked_at) return true
      const nextCheck = new Date(
        new Date(row.last_checked_at).getTime() + row.interval_hours * 60 * 60 * 1000
      )
      return now >= nextCheck
    }) : scopedWatched

    logInfo("watched_repos.check_started", {
      requestId,
      systemRunId,
      teamId: requestTeamId ?? undefined,
      details: { due: dueRepos.length, active: (allWatched ?? []).length },
    })

    const results: Array<{
      watchedRepoId: string
      repo: string
      newContributors: number
      baselinedContributors?: number
      notified?: boolean
      error?: string
    }> = []

    for (const watched of dueRepos) {
      try {
        const githubClient = createGitHubClient(githubToken)
        const contributors = await githubClient.getRepoContributors(watched.repo)
        const isInitialBaseline = !watched.last_checked_at

        if (!contributors || contributors.length === 0) {
          await supabaseAdmin
            .from("watched_repos")
            .update({ last_checked_at: now.toISOString() })
            .eq("id", watched.id)
            .eq("team_id", watched.team_id)
          results.push({
            watchedRepoId: watched.id,
            repo: watched.repo,
            newContributors: 0,
            baselinedContributors: isInitialBaseline ? 0 : undefined,
            notified: false,
          })
          continue
        }

        // Fetch existing tracked contributor logins for this watched repo
        const { data: existingLinks } = await supabaseAdmin
          .from("watched_repo_contributors")
          .select("github_username")
          .eq("team_id", watched.team_id)
          .eq("watched_repo_id", watched.id)
        const knownUsernames = new Set((existingLinks ?? []).map((r) => r.github_username))

        const newContributors: Array<{ username: string; name: string | null; avatar: string | null }> = []

        for (const contributor of contributors) {
          if (knownUsernames.has(contributor.login)) continue

          // New contributor — fetch details, upsert into contributors table
          try {
            const details = await githubClient.getUserDetails(contributor.login)
            const socialAccounts = await githubClient.getUserSocialAccounts(contributor.login)
            const bioContacts  = extractContactsFromBio(details.bio)
            const blogContacts = extractContactsFromBio(details.blog)
            const socialContacts = extractSocialContacts(socialAccounts)
            const structured = {
              email:    details.email || undefined,
              twitter:  socialContacts.twitter ?? details.twitter_username ?? blogContacts.twitter ?? undefined,
              linkedin: blogContacts.linkedin ?? undefined,
              website:
                details.blog && !/(linkedin\.com|twitter\.com|x\.com)/i.test(details.blog) ? details.blog : undefined,
            }
            const contacts = {
              email:    structured.email    ?? bioContacts.email    ?? null,
              twitter:  structured.twitter  ?? null,
              linkedin: socialContacts.linkedin ?? structured.linkedin ?? bioContacts.linkedin ?? null,
              website:  structured.website  ?? bioContacts.website  ?? null,
            }

            await upsertContributor({
              team_id: watched.team_id,
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
            await supabaseAdmin.from("watched_repo_contributors").insert({
              team_id: watched.team_id,
              watched_repo_id: watched.id,
              github_username: contributor.login,
              first_seen_at: now.toISOString(),
            })

            if (!isInitialBaseline) {
              newContributors.push({
                username: contributor.login,
                name: details.name ?? null,
                avatar: details.avatar_url ?? null,
              })
            }
          } catch (err) {
            logError("watched_repos.contributor_failed", err, {
              requestId,
              systemRunId,
              teamId: watched.team_id,
              details: { watchId: watched.id },
            })
          }
        }

        // Send Slack notification if there are new contributors and webhook is configured
        const shouldNotify = !isInitialBaseline && newContributors.length > 0 && Boolean(slackWebhookUrl)
        if (shouldNotify && slackWebhookUrl) {
          await sendSlackNotification(slackWebhookUrl, watched.repo, newContributors)
        }

        if (!isInitialBaseline && newContributors.length > 0) {
          await recordActivityEvent({
            teamId: watched.team_id,
            actorEmail: isCronRequest ? null : requestActorEmail,
            type: "watched_repo.contributors_found",
            title: "Contributors found",
            description: `${newContributors.length} new contributor${newContributors.length === 1 ? "" : "s"} in ${watched.repo}`,
            metadata: {
              watchedRepoId: watched.id,
              repo: watched.repo,
              newContributors: newContributors.length,
              trigger: isCronRequest ? "cron" : "manual",
              notified: shouldNotify,
            },
          })
        }

        // Update last_checked_at
        await supabaseAdmin
          .from("watched_repos")
          .update({ last_checked_at: now.toISOString() })
          .eq("id", watched.id)
          .eq("team_id", watched.team_id)

        results.push({
          watchedRepoId: watched.id,
          repo: watched.repo,
          newContributors: newContributors.length,
          baselinedContributors: isInitialBaseline ? contributors.length : undefined,
          notified: shouldNotify,
        })
      } catch (err) {
        logError("watched_repos.repository_failed", err, {
          requestId,
          systemRunId,
          teamId: watched.team_id,
          details: { watchId: watched.id },
        })
        results.push({
          watchedRepoId: watched.id,
          repo: watched.repo,
          newContributors: 0,
          error: err instanceof Error ? err.message : "Unknown error",
        })
      }
    }

    await recordAuditEvent({
      request,
      action: "watched_repo.check",
      outcome: "success",
      actor: isCronRequest ? "cron" : "admin",
      teamId: requestTeamId,
      metadata: {
        checked: dueRepos.length,
        trigger: isCronRequest ? "cron" : "manual",
        teamSlug: requestTeamSlug,
        newContributors: results.reduce((sum, result) => sum + result.newContributors, 0),
        errors: results.filter((result) => result.error).length,
      },
    })
    await finishSystemRun(systemRunId, results.some((result) => result.error) ? "failure" : "success", {
      checked: dueRepos.length,
      errors: results.filter((result) => result.error).length,
      newContributors: results.reduce((sum, result) => sum + result.newContributors, 0),
    })
    logInfo("watched_repos.check_finished", {
      requestId,
      systemRunId,
      teamId: requestTeamId ?? undefined,
      details: {
        checked: dueRepos.length,
        errors: results.filter((result) => result.error).length,
        newContributors: results.reduce((sum, result) => sum + result.newContributors, 0),
      },
    })
    return NextResponse.json({ checked: dueRepos.length, results })
  } catch (error) {
    await finishSystemRun(systemRunId, "failure", {}, error)
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    logError("watched_repos.failed", error, {
      requestId,
      systemRunId,
      teamId: requestTeamId ?? undefined,
    })
    return NextResponse.json({ error: "Failed to run check" }, { status: 500 })
  }
}
