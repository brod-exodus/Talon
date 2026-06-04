import { type NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"

const GROUP_LIMIT = 5

type SearchResult = {
  id: string
  title: string
  subtitle?: string
  href: string
}

type ContributorSearchRow = {
  id: string
  github_username: string
  name: string | null
  avatar_url: string | null
}

type ScrapeSearchRow = {
  id: string
  target: string
  type: string
  status: string
  completed_at: string | null
  started_at: string | null
}

type ProjectSearchRow = {
  id: string
  name: string
  created_at: string
}

type WatchedRepoSearchRow = {
  id: string
  repo: string
  active: boolean
  last_checked_at: string | null
}

function normalizeSearchQuery(query: string): string {
  return query.replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim()
}

function searchPattern(query: string): string {
  return `%${query}%`
}

function formatScrapeStatus(status: string): string {
  if (status === "completed") return "Completed scrape"
  if (status === "active") return "Active scrape"
  if (status === "failed") return "Failed scrape"
  if (status === "canceled") return "Canceled scrape"
  return "Scrape"
}

function jsonWithDevMetrics(startedAt: number, query: string, payload: unknown) {
  if (process.env.NODE_ENV !== "production") {
    const bytes = Buffer.byteLength(JSON.stringify(payload), "utf8")
    const data = payload as {
      groups?: {
        contributors?: unknown[]
        scrapes?: unknown[]
        projects?: unknown[]
        watchedRepos?: unknown[]
      }
    }
    console.info("[search] GET", {
      queryLength: query.length,
      counts: {
        contributors: data.groups?.contributors?.length ?? 0,
        scrapes: data.groups?.scrapes?.length ?? 0,
        projects: data.groups?.projects?.length ?? 0,
        watchedRepos: data.groups?.watchedRepos?.length ?? 0,
      },
      bytes,
      durationMs: Math.round(performance.now() - startedAt),
    })
  }
  return NextResponse.json(payload)
}

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  const startedAt = performance.now()
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? ""
  const normalizedQuery = normalizeSearchQuery(query)
  if (normalizedQuery.length < 2) {
    return jsonWithDevMetrics(startedAt, normalizedQuery, {
      query,
      groups: { contributors: [], scrapes: [], projects: [], watchedRepos: [] },
    })
  }

  try {
    const { teamId } = await resolveTeamContext(request)
    const pattern = searchPattern(normalizedQuery)

    const [
      contributorsResult,
      scrapesResult,
      projectsResult,
      watchedReposResult,
    ] = await Promise.all([
      supabaseAdmin
        .from("contributors")
        .select("id, github_username, name, avatar_url")
        .eq("team_id", teamId)
        .or(`github_username.ilike.${pattern},name.ilike.${pattern}`)
        .order("github_username", { ascending: true })
        .limit(GROUP_LIMIT),
      supabaseAdmin
        .from("scrapes")
        .select("id, target, type, status, completed_at, started_at")
        .eq("team_id", teamId)
        .ilike("target", pattern)
        .order("started_at", { ascending: false })
        .limit(GROUP_LIMIT),
      supabaseAdmin
        .from("ecosystems")
        .select("id, name, created_at")
        .eq("team_id", teamId)
        .ilike("name", pattern)
        .order("created_at", { ascending: false })
        .limit(GROUP_LIMIT),
      supabaseAdmin
        .from("watched_repos")
        .select("id, repo, active, last_checked_at")
        .eq("team_id", teamId)
        .ilike("repo", pattern)
        .order("created_at", { ascending: false })
        .limit(GROUP_LIMIT),
    ])

    if (contributorsResult.error) throw contributorsResult.error
    if (scrapesResult.error) throw scrapesResult.error
    if (projectsResult.error) throw projectsResult.error
    if (watchedReposResult.error) throw watchedReposResult.error

    const contributors = (contributorsResult.data ?? []) as ContributorSearchRow[]

    const groups = {
      contributors: contributors.map<SearchResult>((contributor) => {
        return {
          id: contributor.id,
          title: contributor.github_username,
          subtitle: contributor.name ?? "Contributor",
          href: `/contributors/${contributor.id}`,
        }
      }),
      scrapes: ((scrapesResult.data ?? []) as ScrapeSearchRow[]).map<SearchResult>((scrape) => ({
        id: scrape.id,
        title: scrape.target,
        subtitle: `${formatScrapeStatus(scrape.status)} · ${scrape.type}`,
        href: "/",
      })),
      projects: ((projectsResult.data ?? []) as ProjectSearchRow[]).map<SearchResult>((project) => ({
        id: project.id,
        title: project.name,
        subtitle: "Project",
        href: `/ecosystems/${project.id}`,
      })),
      watchedRepos: ((watchedReposResult.data ?? []) as WatchedRepoSearchRow[]).map<SearchResult>((repo) => ({
        id: repo.id,
        title: repo.repo,
        subtitle: repo.active ? "Watched repository" : "Paused watched repository",
        href: "/watched",
      })),
    }

    return jsonWithDevMetrics(startedAt, normalizedQuery, { query, groups })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    console.error("[search] GET error:", error)
    return NextResponse.json({ error: "Failed to search Talon" }, { status: 500 })
  }
}
