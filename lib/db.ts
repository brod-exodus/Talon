import { supabase } from "@/lib/supabase"

// Expected Supabase tables: scrapes (id, type, target, status, progress, current, total, current_user_login, started_at, completed_at, error),
// contributors (id, github_username, name, avatar_url, bio, location, company, email, twitter, linkedin, website, contacted, contacted_date, outreach_notes, status),
// scrape_contributors (scrape_id, contributor_id, contributions) with UNIQUE(scrape_id, contributor_id).

// DB row types (snake_case to match Supabase)
export type ScrapeRow = {
  id: string
  type: string
  target: string
  status: "active" | "completed" | "failed"
  progress: number
  current: number
  total: number
  current_user_login: string | null
  started_at: string
  completed_at: string | null
  error: string | null
}

export type ContributorRow = {
  id: string
  github_username: string
  name: string | null
  avatar_url: string | null
  bio: string | null
  location: string | null
  company: string | null
  email: string | null
  twitter: string | null
  linkedin: string | null
  website: string | null
  contacted: boolean
  contacted_date: string | null
  outreach_notes: string | null
  status: string | null
}

export type ScrapeContributorRow = {
  scrape_id: string
  contributor_id: string
  contributions: number
}

// App-facing contributor shape (from DB + scrape_contributors.contributions)
export type ContributorWithContributions = ContributorRow & { contributions: number }

/** Map DB row + contributions to app contributor shape */
export function toAppContributor(c: ContributorWithContributions): {
  id: string
  username: string
  name: string
  avatar: string
  contributions: number
  bio?: string
  location?: string
  company?: string
  contacts: { email?: string; twitter?: string; linkedin?: string; website?: string }
  contacted: boolean
  contactedDate: string | null
  notes: string | null
  status: string | null
} {
  return {
    id: c.id,
    username: c.github_username,
    name: c.name ?? c.github_username,
    avatar: c.avatar_url ?? "",
    contributions: c.contributions,
    bio: c.bio ?? undefined,
    location: c.location ?? undefined,
    company: c.company ?? undefined,
    contacts: {
      email: c.email ?? undefined,
      twitter: c.twitter ?? undefined,
      linkedin: c.linkedin ?? undefined,
      website: c.website ?? undefined,
    },
    contacted: c.contacted,
    contactedDate: c.contacted_date,
    notes: c.outreach_notes,
    status: c.status,
  }
}

export async function createScrape(id: string, type: string, target: string): Promise<void> {
  const { error } = await supabase.from("scrapes").insert({
    id,
    type,
    target,
    status: "active",
    progress: 0,
    current: 0,
    total: 0,
    current_user_login: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    error: null,
  })
  if (error) throw error
}

export async function updateScrapeProgress(
  id: string,
  data: { progress: number; current: number; total: number; current_user_login?: string | null }
): Promise<void> {
  const { error } = await supabase
    .from("scrapes")
    .update({
      progress: data.progress,
      current: data.current,
      total: data.total,
      current_user_login: data.current_user_login ?? null,
    })
    .eq("id", id)
  if (error) throw error
}

export async function failScrape(id: string, errorMessage: string): Promise<void> {
  const { error } = await supabase
    .from("scrapes")
    .update({ status: "failed", error: errorMessage })
    .eq("id", id)
  if (error) throw error
}

/** Upsert contributor: on conflict (github_username) update only profile fields, preserve contacted/contacted_date/outreach_notes/status */
export async function upsertContributor(profile: {
  github_username: string
  name: string | null
  avatar_url: string | null
  bio: string | null
  location: string | null
  company: string | null
  email: string | null
  twitter: string | null
  linkedin: string | null
  website: string | null
}): Promise<string> {
  const { data: existing } = await supabase
    .from("contributors")
    .select("id")
    .eq("github_username", profile.github_username)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from("contributors")
      .update({
        name: profile.name,
        avatar_url: profile.avatar_url,
        bio: profile.bio,
        location: profile.location,
        company: profile.company,
        email: profile.email,
        twitter: profile.twitter,
        linkedin: profile.linkedin,
        website: profile.website,
      })
      .eq("id", existing.id)
    if (error) throw error
    return existing.id
  }

  const { data: inserted, error } = await supabase
    .from("contributors")
    .insert({
      github_username: profile.github_username,
      name: profile.name,
      avatar_url: profile.avatar_url,
      bio: profile.bio,
      location: profile.location,
      company: profile.company,
      email: profile.email,
      twitter: profile.twitter,
      linkedin: profile.linkedin,
      website: profile.website,
      contacted: false,
      contacted_date: null,
      outreach_notes: null,
      status: null,
    })
    .select("id")
    .single()
  if (error) throw error
  if (!inserted?.id) throw new Error("No id returned from contributors insert")
  return inserted.id
}

export async function linkScrapeContributor(
  scrapeId: string,
  contributorId: string,
  contributions: number
): Promise<void> {
  const { error } = await supabase.from("scrape_contributors").upsert(
    { scrape_id: scrapeId, contributor_id: contributorId, contributions },
    { onConflict: "scrape_id,contributor_id" }
  )
  if (error) throw error
}

export async function completeScrape(
  id: string,
  contributors: Array<{
    username: string
    name: string
    avatar: string
    contributions: number
    bio?: string
    location?: string
    company?: string
    contacts: { email?: string; twitter?: string; linkedin?: string; website?: string }
  }>
): Promise<void> {
  for (const c of contributors) {
    const contributorId = await upsertContributor({
      github_username: c.username,
      name: c.name || null,
      avatar_url: c.avatar || null,
      bio: c.bio ?? null,
      location: c.location ?? null,
      company: c.company ?? null,
      email: c.contacts?.email ?? null,
      twitter: c.contacts?.twitter ?? null,
      linkedin: c.contacts?.linkedin ?? null,
      website: c.contacts?.website ?? null,
    })
    await linkScrapeContributor(id, contributorId, c.contributions)
  }
  const { error } = await supabase
    .from("scrapes")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      error: null,
      current_user_login: null,
    })
    .eq("id", id)
  if (error) throw error
}

export type AppScrape = {
  id: string
  type: string
  target: string
  status: string
  progress: number
  current: number
  total: number
  currentUser?: string
  startedAt: string
  completedAt?: string
  error?: string
  contributors: ReturnType<typeof toAppContributor>[]
}

export async function getScrape(id: string): Promise<AppScrape | null> {
  const { data: scrape, error: scrapeError } = await supabase
    .from("scrapes")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (scrapeError) throw scrapeError
  if (!scrape) return null

  const { data: links, error: linksError } = await supabase
    .from("scrape_contributors")
    .select("contributor_id, contributions")
    .eq("scrape_id", id)
  if (linksError) throw linksError

  if (!links?.length) {
    return {
      id: scrape.id,
      type: scrape.type,
      target: scrape.target,
      status: scrape.status,
      progress: scrape.progress,
      current: scrape.current,
      total: scrape.total,
      currentUser: scrape.current_user_login ?? undefined,
      startedAt: scrape.started_at,
      completedAt: scrape.completed_at ?? undefined,
      error: scrape.error ?? undefined,
      contributors: [],
    }
  }

  const { data: contributors, error: contribError } = await supabase
    .from("contributors")
    .select("*")
    .in("id", links.map((l) => l.contributor_id))
  if (contribError) throw contribError

  const contribMap = new Map(links.map((l) => [l.contributor_id, l.contributions]))
  const contributorsWithContributions: ContributorWithContributions[] = (contributors ?? []).map((c) => ({
    ...c,
    contributions: contribMap.get(c.id) ?? 0,
  }))

  return {
    id: scrape.id,
    type: scrape.type,
    target: scrape.target,
    status: scrape.status,
    progress: scrape.progress,
    current: scrape.current,
    total: scrape.total,
    currentUser: scrape.current_user_login ?? undefined,
    startedAt: scrape.started_at,
    completedAt: scrape.completed_at ?? undefined,
    error: scrape.error ?? undefined,
    contributors: contributorsWithContributions.map(toAppContributor),
  }
}

export async function getScrapes(): Promise<{
  active: Array<{
    id: string
    target: string
    type: string
    progress: number
    current: number
    total: number
    currentUser?: string
    startedAt: string
  }>
  completed: Array<{
    id: string
    target: string
    type: string
    completedAt: string
    contributors: ReturnType<typeof toAppContributor>[]
  }>
}> {
  const { data: rows, error } = await supabase
    .from("scrapes")
    .select("*")
    .order("started_at", { ascending: false })
  if (error) throw error

  const active: Array<{
    id: string
    target: string
    type: string
    progress: number
    current: number
    total: number
    currentUser?: string
    startedAt: string
  }> = []
  const completed: Array<{
    id: string
    target: string
    type: string
    completedAt: string
    contributors: ReturnType<typeof toAppContributor>[]
  }> = []

  for (const row of rows ?? []) {
    if (row.status === "active") {
      active.push({
        id: row.id,
        target: row.target,
        type: row.type,
        progress: row.progress,
        current: row.current,
        total: row.total,
        currentUser: row.current_user_login ?? undefined,
        startedAt: row.started_at,
      })
    } else if (row.status === "completed") {
      const { data: links } = await supabase
        .from("scrape_contributors")
        .select("contributor_id, contributions")
        .eq("scrape_id", row.id)
      const contributorIds = (links ?? []).map((l) => l.contributor_id)
      const { data: contribs } = await supabase
        .from("contributors")
        .select("*")
        .in("id", contributorIds)
      const linkMap = new Map((links ?? []).map((l) => [l.contributor_id, l.contributions]))
      const contributorsWithContributions: ContributorWithContributions[] = (contribs ?? []).map((c) => ({
        ...c,
        contributions: linkMap.get(c.id) ?? 0,
      }))
      completed.push({
        id: row.id,
        target: row.target,
        type: row.type,
        completedAt: row.completed_at ?? row.started_at,
        contributors: contributorsWithContributions.map(toAppContributor),
      })
    }
  }

  return { active, completed }
}

export async function updateContributorOutreach(
  githubUsername: string,
  updates: {
    contacted?: boolean
    contacted_date?: string | null
    outreach_notes?: string | null
    status?: string | null
  }
): Promise<void> {
  const set: Record<string, unknown> = {}
  if (typeof updates.contacted === "boolean") set.contacted = updates.contacted
  if (updates.contacted_date !== undefined) set.contacted_date = updates.contacted_date
  if (updates.outreach_notes !== undefined) set.outreach_notes = updates.outreach_notes
  if (updates.status !== undefined) set.status = updates.status
  if (Object.keys(set).length === 0) return

  const { error } = await supabase
    .from("contributors")
    .update(set)
    .eq("github_username", githubUsername)
  if (error) throw error
}

export async function deleteScrape(id: string): Promise<void> {
  const { error: linkError } = await supabase.from("scrape_contributors").delete().eq("scrape_id", id)
  if (linkError) throw linkError
  const { error: scrapeError } = await supabase.from("scrapes").delete().eq("id", id)
  if (scrapeError) throw scrapeError
}
