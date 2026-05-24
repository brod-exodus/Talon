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

type ScrapeContributorSearchRow = {
  contributor_id: string
  scrape_id: string
  contributions: number
}

type EcosystemScrapeSearchRow = {
  ecosystem_id: string
  scrape_id: string
}

function normalizeSearchQuery(query: string): string {
  return query.replace(/[%,]/g, " ").replace(/\s+/g, " ").trim()
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

export async function GET(request: NextRequest) {
  const authError = requireAuth(request)
  if (authError) return authError

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? ""
  const normalizedQuery = normalizeSearchQuery(query)
  if (normalizedQuery.length < 2) {
    return NextResponse.json({
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
        .ilike("github_username", pattern)
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
    const contributorContext = await getContributorContext(
      contributors.map((contributor) => contributor.id),
      teamId
    )

    const groups = {
      contributors: contributors.map<SearchResult>((contributor) => {
        const context = contributorContext.get(contributor.id)
        return {
          id: contributor.id,
          title: contributor.github_username,
          subtitle: context?.subtitle ?? contributor.name ?? "Contributor",
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

    return NextResponse.json({ query, groups })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    console.error("[search] GET error:", error)
    return NextResponse.json({ error: "Failed to search Talon" }, { status: 500 })
  }
}

async function getContributorContext(
  contributorIds: string[],
  teamId: string
): Promise<Map<string, { href: string; subtitle: string }>> {
  const context = new Map<string, { href: string; subtitle: string }>()
  if (contributorIds.length === 0) return context

  const { data: links, error: linkError } = await supabaseAdmin
    .from("scrape_contributors")
    .select("contributor_id, scrape_id, contributions")
    .in("contributor_id", contributorIds)
    .order("contributions", { ascending: false })
  if (linkError) throw linkError

  const scrapeContributorRows = (links ?? []) as ScrapeContributorSearchRow[]
  const scrapeIds = Array.from(new Set(scrapeContributorRows.map((link) => link.scrape_id)))
  if (scrapeIds.length === 0) return context

  const { data: scrapes, error: scrapeError } = await supabaseAdmin
    .from("scrapes")
    .select("id, target")
    .eq("team_id", teamId)
    .in("id", scrapeIds)
  if (scrapeError) throw scrapeError

  const scrapesById = new Map((scrapes ?? []).map((scrape) => [scrape.id, scrape.target]))
  const validScrapeIds = scrapeIds.filter((scrapeId) => scrapesById.has(scrapeId))
  if (validScrapeIds.length === 0) return context

  const { data: projectLinks, error: projectLinkError } = await supabaseAdmin
    .from("ecosystem_scrapes")
    .select("ecosystem_id, scrape_id")
    .eq("team_id", teamId)
    .in("scrape_id", validScrapeIds)
  if (projectLinkError) throw projectLinkError

  const ecosystemScrapeRows = (projectLinks ?? []) as EcosystemScrapeSearchRow[]
  const projectIds = Array.from(new Set(ecosystemScrapeRows.map((link) => link.ecosystem_id)))
  const projectNamesById = new Map<string, string>()
  if (projectIds.length > 0) {
    const { data: projects, error: projectError } = await supabaseAdmin
      .from("ecosystems")
      .select("id, name")
      .eq("team_id", teamId)
      .in("id", projectIds)
    if (projectError) throw projectError
    for (const project of projects ?? []) {
      projectNamesById.set(project.id, project.name)
    }
  }

  const firstProjectByScrapeId = new Map<string, { id: string; name: string }>()
  for (const link of ecosystemScrapeRows) {
    if (firstProjectByScrapeId.has(link.scrape_id)) continue
    const name = projectNamesById.get(link.ecosystem_id)
    if (!name) continue
    firstProjectByScrapeId.set(link.scrape_id, { id: link.ecosystem_id, name })
  }

  for (const contributorId of contributorIds) {
    const bestLink = scrapeContributorRows.find((link) => link.contributor_id === contributorId && scrapesById.has(link.scrape_id))
    if (!bestLink) continue
    const project = firstProjectByScrapeId.get(bestLink.scrape_id)
    if (project) {
      context.set(contributorId, {
        subtitle: `Contributor in ${project.name}`,
        href: `/contributors/${contributorId}`,
      })
      continue
    }
    context.set(contributorId, {
      subtitle: `Contributor in ${scrapesById.get(bestLink.scrape_id)}`,
      href: `/contributors/${contributorId}`,
    })
  }

  return context
}
