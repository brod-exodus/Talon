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

/** Fetches only the scrapes row — no contributor data. Used by the paginated GET handler. */
export async function getScrapeMetadata(id: string): Promise<Omit<AppScrape, "contributors"> | null> {
  const { data: scrape, error } = await supabase
    .from("scrapes")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  if (!scrape) return null
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
  }
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

export type ScrapeSummary = {
  id: string
  target: string
  type: string
  completedAt: string
  contributorCount: number
}

/**
 * Lightweight list query: 2 DB round trips regardless of scrape count.
 * Does NOT load contributor details — use getScrape(id) for lazy-loaded detail.
 */
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
  completed: ScrapeSummary[]
}> {
  // Query 1: fetch all scrapes (select only needed columns)
  const { data: rows, error } = await supabase
    .from("scrapes")
    .select("id, type, target, status, progress, current, total, current_user_login, started_at, completed_at")
    .order("started_at", { ascending: false })
  if (error) throw error

  const completedRows = (rows ?? []).filter((r) => r.status === "completed")
  const completedIds = completedRows.map((r) => r.id)

  // Query 2: batch-fetch contributor counts for all completed scrapes at once
  const countMap = new Map<string, number>()
  if (completedIds.length > 0) {
    const { data: linkRows } = await supabase
      .from("scrape_contributors")
      .select("scrape_id")
      .in("scrape_id", completedIds)
    for (const row of linkRows ?? []) {
      countMap.set(row.scrape_id, (countMap.get(row.scrape_id) ?? 0) + 1)
    }
  }

  const active = (rows ?? [])
    .filter((r) => r.status === "active")
    .map((r) => ({
      id: r.id,
      target: r.target,
      type: r.type,
      progress: r.progress,
      current: r.current,
      total: r.total,
      currentUser: r.current_user_login ?? undefined,
      startedAt: r.started_at,
    }))

  const completed: ScrapeSummary[] = completedRows.map((r) => ({
    id: r.id,
    target: r.target,
    type: r.type,
    completedAt: r.completed_at ?? r.started_at,
    contributorCount: countMap.get(r.id) ?? 0,
  }))

  return { active, completed }
}

const PAGE_SIZE = 100

/**
 * Fetch one page of contributors for a scrape.
 *
 * Deliberately avoids PostgREST count/range headers entirely — those features
 * trigger Bad Request on large result sets in some Supabase versions.
 * Instead: fetch all link IDs in one plain query, slice in JS, then fetch the
 * contributor rows for just that slice.
 */
export async function getScrapeContributorsPage(
  scrapeId: string,
  page: number,
  pageSize = PAGE_SIZE
): Promise<{
  contributors: ReturnType<typeof toAppContributor>[]
  contributorTotal: number
  page: number
  hasMore: boolean
}> {
  console.log(`[db] getScrapeContributorsPage START – scrapeId=${scrapeId} page=${page} pageSize=${pageSize}`)

  // Query 1: fetch all (contributor_id, contributions) pairs for this scrape — no count, no range.
  console.log(`[db] Q1 START – scrape_contributors.select where scrape_id=${scrapeId}`)
  let allLinks: { contributor_id: string; contributions: number }[]
  try {
    const { data, error: linksError } = await supabase
      .from("scrape_contributors")
      .select("contributor_id, contributions")
      .eq("scrape_id", scrapeId)
    if (linksError) {
      console.error("[db] Q1 FAILED – scrape_contributors query\n" + JSON.stringify(linksError, null, 2))
      throw linksError
    }
    allLinks = data ?? []
    console.log(`[db] Q1 OK – got ${allLinks.length} link rows`)
  } catch (err) {
    console.error("[db] Q1 THREW (unexpected) –\n" + JSON.stringify(err, null, 2))
    throw err
  }

  const contributorTotal = allLinks.length

  if (contributorTotal === 0) {
    console.log("[db] getScrapeContributorsPage END – no contributors")
    return { contributors: [], contributorTotal, page, hasMore: false }
  }

  // Slice in JavaScript — no PostgREST range header needed.
  const from = (page - 1) * pageSize
  const pageLinks = allLinks.slice(from, from + pageSize)
  console.log(`[db] page slice from=${from} pageLinks.length=${pageLinks.length}`)

  if (pageLinks.length === 0) {
    console.log("[db] getScrapeContributorsPage END – page beyond last row")
    return { contributors: [], contributorTotal, page, hasMore: false }
  }

  // Query 2: full contributor rows for this page's IDs only.
  const pageIds = pageLinks.map((l) => l.contributor_id)
  console.log(`[db] Q2 START – contributors.select where id in [${pageIds.length} ids]`)
  let contribRows: ContributorRow[]
  try {
    const { data, error: contribError } = await supabase
      .from("contributors")
      .select("*")
      .in("id", pageIds)
    if (contribError) {
      console.error("[db] Q2 FAILED – contributors query\n" + JSON.stringify(contribError, null, 2))
      throw contribError
    }
    contribRows = data ?? []
    console.log(`[db] Q2 OK – got ${contribRows.length} contributor rows`)
  } catch (err) {
    console.error("[db] Q2 THREW (unexpected) –\n" + JSON.stringify(err, null, 2))
    throw err
  }

  const linkMap = new Map(pageLinks.map((l) => [l.contributor_id, l.contributions]))
  const withContributions: ContributorWithContributions[] = contribRows.map((c) => ({
    ...c,
    contributions: linkMap.get(c.id) ?? 0,
  }))

  const hasMore = from + pageLinks.length < contributorTotal
  console.log(`[db] getScrapeContributorsPage END – returning ${withContributions.length} contributors hasMore=${hasMore}`)

  return {
    contributors: withContributions.map(toAppContributor),
    contributorTotal,
    page,
    hasMore,
  }
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
