import { supabaseAdmin } from "@/lib/supabase"
import { recordActivityEvent } from "@/lib/activity"
import { aggregateEcosystemContributors, shouldRecomputeEcosystemContributorCache } from "@/lib/ecosystem-utils"
import { getDefaultTeamId } from "@/lib/team-context"

// Expected Supabase tables: scrapes (id, type, target, status, progress, current, total, current_user_login, started_at, completed_at, error, contact_info_count, total_contributors),
// contributors (id, github_username, name, avatar_url, bio, location, company, email, twitter, linkedin, website, contacted, contacted_date, outreach_notes, status),
// scrape_contributors (scrape_id, contributor_id, contributions) with UNIQUE(scrape_id, contributor_id).

// DB row types (snake_case to match Supabase)
export type ScrapeRow = {
  id: string
  team_id: string
  type: string
  target: string
  status: "active" | "completed" | "failed" | "canceled"
  progress: number
  current: number
  total: number
  current_user_login: string | null
  started_at: string
  completed_at: string | null
  error: string | null
  min_contributions: number   // requires: ALTER TABLE scrapes ADD COLUMN min_contributions integer NOT NULL DEFAULT 1;
  total_contributors?: number  // requires: ALTER TABLE scrapes ADD COLUMN total_contributors INTEGER DEFAULT 0;
}

export type ContributorRow = {
  id: string
  team_id: string
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
  outreach_notes_updated_at?: string | null
  status: string | null
  reminder_note?: string | null
  reminder_date?: string | null
  reminder_updated_at?: string | null
  created_at?: string
  updated_at?: string
}

export type ScrapeContributorRow = {
  scrape_id: string
  contributor_id: string
  contributions: number
}

export type ScrapeJobContributionRow = {
  job_id: string
  team_id: string
  github_login: string
  contributions: number
  updated_at: string
}

export type ScrapeJobEventRow = {
  id: string
  team_id: string
  job_id: string | null
  scrape_id: string | null
  event_type: string
  message: string
  metadata: Record<string, unknown>
  created_at: string
}

export type ScrapeJobEventSummary = {
  id: string
  jobId: string | null
  scrapeId: string | null
  eventType: string
  message: string
  metadata: Record<string, unknown>
  createdAt: string
}

type ScrapeContributorPageRow = {
  contributor_id: string
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
  contributions: number
  contributor_total: number
}

export type ScrapeJobRow = {
  id: string
  team_id: string
  scrape_id: string
  type: "organization" | "repository"
  target: string
  min_contributions: number
  status: "queued" | "running" | "succeeded" | "failed" | "canceled"
  attempts: number
  max_attempts: number
  run_after: string
  locked_at: string | null
  locked_by: string | null
  last_error: string | null
  state: Record<string, unknown>
  cancel_requested: boolean
  created_at: string
  updated_at: string
}

export type ScrapeJobSummary = {
  id: string
  scrapeId: string
  type: "organization" | "repository"
  target: string
  status: "queued" | "running" | "succeeded" | "failed" | "canceled"
  attempts: number
  maxAttempts: number
  runAfter: string
  lockedAt: string | null
  lockedBy: string | null
  lastError: string | null
  cancelRequested: boolean
  recentEvents?: ScrapeJobEventSummary[]
  createdAt: string
  updatedAt: string
}

function toScrapeJobSummary(row: ScrapeJobRow): ScrapeJobSummary {
  return {
    id: row.id,
    scrapeId: row.scrape_id,
    type: row.type,
    target: row.target,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    cancelRequested: row.cancel_requested,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toScrapeJobEventSummary(row: ScrapeJobEventRow): ScrapeJobEventSummary {
  return {
    id: row.id,
    jobId: row.job_id,
    scrapeId: row.scrape_id,
    eventType: row.event_type,
    message: row.message,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  }
}

async function resolveTeamId(teamId?: string): Promise<string> {
  return teamId ?? (await getDefaultTeamId())
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

export async function createScrape(
  id: string,
  type: string,
  target: string,
  minContributions = 1,
  teamId?: string
): Promise<void> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { error } = await supabaseAdmin.from("scrapes").insert({
    id,
    team_id: resolvedTeamId,
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
    min_contributions: Math.max(1, Math.floor(minContributions)),
  })
  if (error) throw error
}

export async function createScrapeJob(
  scrapeId: string,
  type: "organization" | "repository",
  target: string,
  minContributions = 1,
  teamId?: string
): Promise<ScrapeJobRow> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data, error } = await supabaseAdmin
    .from("scrape_jobs")
    .insert({
      scrape_id: scrapeId,
      team_id: resolvedTeamId,
      type,
      target,
      min_contributions: Math.max(1, Math.floor(minContributions)),
      status: "queued",
      run_after: new Date().toISOString(),
      state: {},
      cancel_requested: false,
    })
    .select("*")
    .single()
  if (error) throw error
  const job = data as ScrapeJobRow
  await recordScrapeJobEvent(job.id, job.scrape_id, "queued", `Queued ${type} scrape for ${target}`, {
    type,
    target,
    minContributions: Math.max(1, Math.floor(minContributions)),
  })
  return job
}

export async function claimNextScrapeJob(workerId: string, teamId?: string): Promise<ScrapeJobRow | null> {
  const now = new Date().toISOString()
  let query = supabaseAdmin
    .from("scrape_jobs")
    .select("*")
    .eq("status", "queued")
    .lte("run_after", now)
    .order("created_at", { ascending: true })
    .limit(5)
  if (teamId) query = query.eq("team_id", teamId)
  const { data: candidates, error: selectError } = await query
  if (selectError) throw selectError

  for (const candidate of (candidates ?? []) as ScrapeJobRow[]) {
    const { data: claimed, error: updateError } = await supabaseAdmin
      .from("scrape_jobs")
      .update({
        status: "running",
        attempts: candidate.attempts + 1,
        locked_at: now,
        locked_by: workerId,
        updated_at: now,
      })
      .eq("id", candidate.id)
      .match(teamId ? { team_id: teamId } : {})
      .eq("status", "queued")
      .select("*")
      .maybeSingle()
    if (updateError) throw updateError
    if (claimed) {
      const job = claimed as ScrapeJobRow
      await recordScrapeJobEvent(job.id, job.scrape_id, "claimed", "Worker claimed scrape job", {
        workerId,
        attempt: job.attempts,
      })
      return job
    }
  }

  return null
}

export async function succeedScrapeJob(id: string): Promise<"succeeded" | "canceled"> {
  const { data, error } = await supabaseAdmin
    .from("scrape_jobs")
    .update({
      status: "succeeded",
      locked_at: null,
      locked_by: null,
      last_error: null,
      cancel_requested: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("cancel_requested", false)
    .neq("status", "canceled")
    .select("id")
    .maybeSingle()
  if (error) throw error
  if (!data) {
    await cancelScrapeJob(id)
    return "canceled"
  }
  await recordScrapeJobEvent(id, null, "succeeded", "Scrape job succeeded")
  return "succeeded"
}

export async function updateScrapeJobState(id: string, state: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin
    .from("scrape_jobs")
    .update({
      state,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (error) throw error
}

export async function recordScrapeJobEvent(
  jobId: string | null,
  scrapeId: string | null,
  eventType: string,
  message: string,
  metadata: Record<string, unknown> = {},
  teamId?: string
): Promise<void> {
  let resolvedTeamId = teamId
  if (!resolvedTeamId && jobId) {
    const { data } = await supabaseAdmin.from("scrape_jobs").select("team_id").eq("id", jobId).maybeSingle()
    resolvedTeamId = data?.team_id
  }
  if (!resolvedTeamId && scrapeId) {
    const { data } = await supabaseAdmin.from("scrapes").select("team_id").eq("id", scrapeId).maybeSingle()
    resolvedTeamId = data?.team_id
  }
  resolvedTeamId ??= await getDefaultTeamId()

  const { error } = await supabaseAdmin.from("scrape_job_events").insert({
    team_id: resolvedTeamId,
    job_id: jobId,
    scrape_id: scrapeId,
    event_type: eventType,
    message,
    metadata,
  })
  if (error) {
    console.error("[scrape-job-events] insert failed:", error)
  }
}

async function getScrapeJobTeamId(jobId: string): Promise<string> {
  const { data, error } = await supabaseAdmin.from("scrape_jobs").select("team_id").eq("id", jobId).maybeSingle()
  if (error) throw error
  return data?.team_id ?? (await getDefaultTeamId())
}

export async function getScrapeJobContributionMap(jobId: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("scrape_job_contributions")
      .select("github_login, contributions")
      .eq("job_id", jobId)
      .range(from, from + pageSize - 1)
    if (error) throw error
    for (const row of (data ?? []) as Pick<ScrapeJobContributionRow, "github_login" | "contributions">[]) {
      map.set(row.github_login, row.contributions)
    }
    if (!data || data.length < pageSize) break
  }
  return map
}

export async function upsertScrapeJobContributionTotals(
  jobId: string,
  totals: Array<{ login: string; contributions: number }>
): Promise<void> {
  const now = new Date().toISOString()
  const teamId = await getScrapeJobTeamId(jobId)
  for (let i = 0; i < totals.length; i += 500) {
    const batch = totals.slice(i, i + 500)
    const { error } = await supabaseAdmin.from("scrape_job_contributions").upsert(
      batch.map((row) => ({
        job_id: jobId,
        team_id: teamId,
        github_login: row.login,
        contributions: Math.max(0, Math.floor(row.contributions)),
        updated_at: now,
      })),
      { onConflict: "job_id,github_login" }
    )
    if (error) throw error
  }
}

export async function getScrapeJobContributionCandidates(
  jobId: string,
  minContributions: number
): Promise<Array<{ login: string; contributions: number }>> {
  const candidates: Array<{ login: string; contributions: number }> = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("scrape_job_contributions")
      .select("github_login, contributions")
      .eq("job_id", jobId)
      .gte("contributions", Math.max(1, Math.floor(minContributions)))
      .order("contributions", { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw error
    candidates.push(
      ...((data ?? []) as Pick<ScrapeJobContributionRow, "github_login" | "contributions">[]).map((row) => ({
        login: row.github_login,
        contributions: row.contributions,
      }))
    )
    if (!data || data.length < pageSize) break
  }
  return candidates
}

export async function getScrapeJobControl(id: string): Promise<Pick<ScrapeJobRow, "status" | "cancel_requested"> | null> {
  const { data, error } = await supabaseAdmin
    .from("scrape_jobs")
    .select("status, cancel_requested")
    .eq("id", id)
    .maybeSingle()
  if (error) throw error
  return data as Pick<ScrapeJobRow, "status" | "cancel_requested"> | null
}

export async function cancelScrapeJob(
  id: string,
  reason = "Scrape canceled",
  teamId?: string
): Promise<ScrapeJobSummary> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from("scrape_jobs")
    .update({
      status: "canceled",
      cancel_requested: true,
      locked_at: null,
      locked_by: null,
      last_error: reason,
      updated_at: now,
    })
    .eq("id", id)
    .match(teamId ? { team_id: teamId } : {})
    .neq("status", "succeeded")
    .select("*")
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Succeeded scrape jobs cannot be canceled")

  const job = data as ScrapeJobRow
  const { error: scrapeError } = await supabaseAdmin
    .from("scrapes")
    .update({
      status: "canceled",
      completed_at: now,
      error: reason,
      current_user_login: null,
    })
    .eq("id", job.scrape_id)
    .eq("team_id", job.team_id)
  if (scrapeError) throw scrapeError

  await recordScrapeJobEvent(job.id, job.scrape_id, "canceled", reason)
  return toScrapeJobSummary(job)
}

export async function failScrapeJob(
  job: ScrapeJobRow,
  errorMessage: string,
  options: { retryAfterMs?: number } = {}
): Promise<"queued" | "failed"> {
  const terminal = job.attempts >= job.max_attempts
  const retryDelayMs =
    options.retryAfterMs && Number.isFinite(options.retryAfterMs)
      ? Math.max(60 * 1000, options.retryAfterMs)
      : Math.min(60, 2 ** job.attempts) * 60 * 1000
  const nextRun = new Date(Date.now() + retryDelayMs).toISOString()
  const { error } = await supabaseAdmin
    .from("scrape_jobs")
    .update({
      status: terminal ? "failed" : "queued",
      locked_at: null,
      locked_by: null,
      last_error: errorMessage,
      run_after: terminal ? job.run_after : nextRun,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
  if (error) throw error
  if (terminal) {
    await failScrape(job.scrape_id, errorMessage)
  }
  await recordScrapeJobEvent(job.id, job.scrape_id, terminal ? "failed" : "retry_scheduled", errorMessage, {
    nextRun: terminal ? null : nextRun,
    attempt: job.attempts,
    maxAttempts: job.max_attempts,
  })
  return terminal ? "failed" : "queued"
}

export async function getScrapeJobSummaries(limit = 50, teamId?: string): Promise<ScrapeJobSummary[]> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data, error } = await supabaseAdmin
    .from("scrape_jobs")
    .select("*")
    .eq("team_id", resolvedTeamId)
    .order("updated_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  const jobs = ((data ?? []) as ScrapeJobRow[]).map(toScrapeJobSummary)
  const jobIds = jobs.map((job) => job.id)
  const { data: events, error: eventsError } = jobIds.length
    ? await supabaseAdmin
        .from("scrape_job_events")
        .select("*")
        .eq("team_id", resolvedTeamId)
        .in("job_id", jobIds)
        .order("created_at", { ascending: false })
        .limit(jobIds.length * 5)
    : { data: [], error: null }
  if (eventsError) throw eventsError

  const eventsByJob = new Map<string, ScrapeJobEventSummary[]>()
  for (const event of ((events ?? []) as ScrapeJobEventRow[]).map(toScrapeJobEventSummary)) {
    if (!event.jobId) continue
    const list = eventsByJob.get(event.jobId) ?? []
    if (list.length < 5) list.push(event)
    eventsByJob.set(event.jobId, list)
  }

  return jobs.map((job) => ({ ...job, recentEvents: eventsByJob.get(job.id) ?? [] }))
}

export async function retryScrapeJob(id: string, teamId?: string): Promise<ScrapeJobSummary> {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from("scrape_jobs")
    .update({
      status: "queued",
      attempts: 0,
      run_after: now,
      locked_at: null,
      locked_by: null,
      last_error: null,
      cancel_requested: false,
      updated_at: now,
    })
    .eq("id", id)
    .match(teamId ? { team_id: teamId } : {})
    .in("status", ["failed", "canceled", "queued"])
    .select("*")
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Only failed, canceled, or queued retry scrape jobs can be retried")

  const job = data as ScrapeJobRow
  const { error: scrapeError } = await supabaseAdmin
    .from("scrapes")
    .update({
      status: "active",
      progress: 0,
      current: 0,
      total: 0,
      current_user_login: null,
      completed_at: null,
      error: null,
    })
    .eq("id", job.scrape_id)
    .eq("team_id", job.team_id)
  if (scrapeError) throw scrapeError

  await recordScrapeJobEvent(job.id, job.scrape_id, "retried", "Scrape job was manually requeued")
  return toScrapeJobSummary(job)
}

export async function updateScrapeProgress(
  id: string,
  data: { progress: number; current: number; total: number; current_user_login?: string | null }
): Promise<void> {
  const { error } = await supabaseAdmin
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
  const { error } = await supabaseAdmin
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
  team_id?: string
}): Promise<string> {
  const teamId = profile.team_id ?? (await getDefaultTeamId())
  const { data: existing } = await supabaseAdmin
    .from("contributors")
    .select("id")
    .eq("team_id", teamId)
    .eq("github_username", profile.github_username)
    .maybeSingle()

  if (existing) {
    const { error } = await supabaseAdmin
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
      .eq("team_id", teamId)
    if (error) throw error
    return existing.id
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("contributors")
    .insert({
      team_id: teamId,
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
  const { error } = await supabaseAdmin.from("scrape_contributors").upsert(
    { scrape_id: scrapeId, contributor_id: contributorId, contributions },
    { onConflict: "scrape_id,contributor_id" }
  )
  if (error) throw error
}

export type ScrapeContributorProfile = {
  username: string
  name: string
  avatar: string
  contributions: number
  bio?: string
  location?: string
  company?: string
  contacts: { email?: string; twitter?: string; linkedin?: string; website?: string }
}

export async function persistScrapeContributors(
  id: string,
  contributors: ScrapeContributorProfile[]
): Promise<void> {
  const { data: scrape, error: scrapeError } = await supabaseAdmin.from("scrapes").select("team_id").eq("id", id).maybeSingle()
  if (scrapeError) throw scrapeError
  const teamId = scrape?.team_id ?? (await getDefaultTeamId())

  for (const c of contributors) {
    const contributorId = await upsertContributor({
      team_id: teamId,
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
}

export async function getScrapeContributorUsernames(id: string): Promise<Set<string>> {
  const { data: scrape, error: scrapeError } = await supabaseAdmin.from("scrapes").select("team_id").eq("id", id).maybeSingle()
  if (scrapeError) throw scrapeError
  const teamId = scrape?.team_id ?? (await getDefaultTeamId())

  const { data: links, error: linkError } = await supabaseAdmin
    .from("scrape_contributors")
    .select("contributor_id")
    .eq("scrape_id", id)
  if (linkError) throw linkError
  if (!links?.length) return new Set()

  const contributorIds = links.map((link) => link.contributor_id)
  const usernames = new Set<string>()
  for (let i = 0; i < contributorIds.length; i += 100) {
    const batch = contributorIds.slice(i, i + 100)
    const { data: contributors, error } = await supabaseAdmin
      .from("contributors")
      .select("github_username")
      .eq("team_id", teamId)
      .in("id", batch)
    if (error) throw error
    for (const contributor of contributors ?? []) usernames.add(contributor.github_username)
  }
  return usernames
}

export async function getScrapeContributorStats(id: string): Promise<{
  contributorTotal: number
  contactInfoCount: number
}> {
  const { data: scrape, error: scrapeError } = await supabaseAdmin.from("scrapes").select("team_id").eq("id", id).maybeSingle()
  if (scrapeError) throw scrapeError
  const teamId = scrape?.team_id ?? (await getDefaultTeamId())

  const { data: links, error: linkError } = await supabaseAdmin
    .from("scrape_contributors")
    .select("contributor_id")
    .eq("scrape_id", id)
  if (linkError) throw linkError
  if (!links?.length) return { contributorTotal: 0, contactInfoCount: 0 }

  const contributorIds = links.map((link) => link.contributor_id)
  let contactInfoCount = 0
  for (let i = 0; i < contributorIds.length; i += 100) {
    const batch = contributorIds.slice(i, i + 100)
    const { data: contributors, error } = await supabaseAdmin
      .from("contributors")
      .select("email, twitter, linkedin, website")
      .eq("team_id", teamId)
      .in("id", batch)
    if (error) throw error
    contactInfoCount += (contributors ?? []).filter((c) =>
      [c.email, c.twitter, c.linkedin, c.website].some((value) => value != null && String(value).trim() !== "")
    ).length
  }

  return { contributorTotal: links.length, contactInfoCount }
}

export async function completeScrape(
  id: string,
  contributors: ScrapeContributorProfile[]
): Promise<void> {
  await persistScrapeContributors(id, contributors)
  const { contributorTotal, contactInfoCount } = await getScrapeContributorStats(id)
  const { data: scrape, error: scrapeFetchError } = await supabaseAdmin
    .from("scrapes")
    .select("team_id, type, target")
    .eq("id", id)
    .maybeSingle()
  if (scrapeFetchError) throw scrapeFetchError
  const resolvedTeamId = scrape?.team_id ?? (await getDefaultTeamId())
  const { error } = await supabaseAdmin
    .from("scrapes")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      error: null,
      current_user_login: null,
      contact_info_count: contactInfoCount,
      total_contributors: contributorTotal,
    })
    .eq("id", id)
  if (error) throw error

  const { data: affectedProjectLinks, error: affectedProjectError } = await supabaseAdmin
    .from("ecosystem_scrapes")
    .select("ecosystem_id")
    .eq("scrape_id", id)
    .eq("team_id", resolvedTeamId)
  if (affectedProjectError) throw affectedProjectError

  const affectedProjectIds = Array.from(new Set((affectedProjectLinks ?? []).map((link) => link.ecosystem_id)))
  await Promise.all(
    affectedProjectIds.map((ecosystemId) => recomputeEcosystemContributorsCache(ecosystemId, resolvedTeamId))
  )
  await recordActivityEvent({
    teamId: resolvedTeamId,
    type: "scrape.completed",
    title: "Scrape completed",
    description: `Found ${contributorTotal.toLocaleString()} contributor${contributorTotal === 1 ? "" : "s"} in ${scrape?.target ?? "this scrape"}.`,
    metadata: {
      scrapeId: id,
      type: scrape?.type,
      target: scrape?.target,
      contributorTotal,
      contactInfoCount,
    },
  })
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
export async function getScrapeMetadata(
  id: string,
  teamId?: string
): Promise<Omit<AppScrape, "contributors"> | null> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data: scrape, error } = await supabaseAdmin
    .from("scrapes")
    .select("*")
    .eq("id", id)
    .eq("team_id", resolvedTeamId)
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

export async function getScrape(id: string, teamId?: string): Promise<AppScrape | null> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data: scrape, error: scrapeError } = await supabaseAdmin
    .from("scrapes")
    .select("*")
    .eq("id", id)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (scrapeError) throw scrapeError
  if (!scrape) return null

  const { data: links, error: linksError } = await supabaseAdmin
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

  const { data: contributors, error: contribError } = await supabaseAdmin
    .from("contributors")
    .select("*")
    .eq("team_id", resolvedTeamId)
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
  contactInfoCount: number  // requires: ALTER TABLE scrapes ADD COLUMN contact_info_count INTEGER DEFAULT 0;
  error?: string
  job?: ScrapeJobSummary
  projects?: Array<{ id: string; name: string }>
}

/**
 * Lightweight list query: one DB round trip. Does NOT load contributor details — use getScrape(id) for lazy-loaded detail.
 */
export async function getScrapes(teamId?: string): Promise<{
  active: Array<{
    id: string
    target: string
    type: string
    progress: number
    current: number
    total: number
    currentUser?: string
    startedAt: string
    job?: ScrapeJobSummary
    projects?: Array<{ id: string; name: string }>
  }>
  failed: ScrapeSummary[]
  completed: ScrapeSummary[]
}> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data: rows, error } = await supabaseAdmin
    .from("scrapes")
    .select(
      "id, type, target, status, progress, current, total, current_user_login, started_at, completed_at, error, contact_info_count, total_contributors"
    )
    .eq("team_id", resolvedTeamId)
    .order("started_at", { ascending: false })
  if (error) throw error

  const scrapeIds = (rows ?? []).map((row) => row.id)
  const { data: jobRows, error: jobError } = scrapeIds.length
    ? await supabaseAdmin.from("scrape_jobs").select("*").eq("team_id", resolvedTeamId).in("scrape_id", scrapeIds)
    : { data: [], error: null }
  if (jobError) throw jobError
  const jobMap = new Map(((jobRows ?? []) as ScrapeJobRow[]).map((job) => [job.scrape_id, toScrapeJobSummary(job)]))
  const projectMap = await getScrapeProjectMap(scrapeIds, resolvedTeamId)

  const completedRows = (rows ?? []).filter((r) => r.status === "completed")
  const failedRows = (rows ?? []).filter((r) => r.status === "failed" || r.status === "canceled")

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
      job: jobMap.get(r.id),
      projects: projectMap.get(r.id) ?? [],
    }))

  const completed: ScrapeSummary[] = completedRows.map((r) => ({
    id: r.id,
    target: r.target,
    type: r.type,
    completedAt: r.completed_at ?? r.started_at,
    contributorCount: r.total_contributors ?? 0,
    contactInfoCount: r.contact_info_count ?? 0,
    job: jobMap.get(r.id),
    projects: projectMap.get(r.id) ?? [],
  }))

  const failed: ScrapeSummary[] = failedRows.map((r) => ({
    id: r.id,
    target: r.target,
    type: r.type,
    completedAt: r.completed_at ?? r.started_at,
    contributorCount: r.total_contributors ?? 0,
    contactInfoCount: r.contact_info_count ?? 0,
    error: r.error ?? undefined,
    job: jobMap.get(r.id),
    projects: projectMap.get(r.id) ?? [],
  }))

  return { active, failed, completed }
}

async function getScrapeProjectMap(
  scrapeIds: string[],
  teamId: string
): Promise<Map<string, Array<{ id: string; name: string }>>> {
  const projectMap = new Map<string, Array<{ id: string; name: string }>>()
  if (scrapeIds.length === 0) return projectMap

  const { data: links, error: linkError } = await supabaseAdmin
    .from("ecosystem_scrapes")
    .select("scrape_id, ecosystem_id")
    .eq("team_id", teamId)
    .in("scrape_id", scrapeIds)
  if (linkError) throw linkError
  if (!links?.length) return projectMap

  const projectIds = Array.from(new Set(links.map((link) => link.ecosystem_id)))
  const { data: projects, error: projectError } = await supabaseAdmin
    .from("ecosystems")
    .select("id, name")
    .eq("team_id", teamId)
    .in("id", projectIds)
  if (projectError) throw projectError

  const projectsById = new Map((projects ?? []).map((project) => [project.id, { id: project.id, name: project.name }]))
  for (const link of links) {
    const project = projectsById.get(link.ecosystem_id)
    if (!project) continue
    const current = projectMap.get(link.scrape_id) ?? []
    current.push(project)
    projectMap.set(link.scrape_id, current)
  }

  return projectMap
}

const PAGE_SIZE = 100

async function getStoredContributorTotal(scrapeId: string, teamId?: string): Promise<number> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data, error } = await supabaseAdmin
    .from("scrapes")
    .select("total_contributors")
    .eq("id", scrapeId)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (error) throw error
  return data?.total_contributors ?? 0
}

export async function getScrapeContributorsPage(
  scrapeId: string,
  page: number,
  pageSize = PAGE_SIZE,
  teamId?: string
): Promise<{
  contributors: ReturnType<typeof toAppContributor>[]
  contributorTotal: number
  page: number
  hasMore: boolean
}> {
  const safePageSize = Math.min(500, Math.max(1, Math.floor(pageSize)))
  const safePage = Math.max(1, Math.floor(page))
  const resolvedTeamId = await resolveTeamId(teamId)
  const offset = (safePage - 1) * safePageSize
  const { data: scrape, error: scrapeError } = await supabaseAdmin
    .from("scrapes")
    .select("id")
    .eq("id", scrapeId)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (scrapeError) throw scrapeError
  if (!scrape) return { contributors: [], contributorTotal: 0, page: safePage, hasMore: false }

  const { data, error } = await supabaseAdmin.rpc("get_scrape_contributors_page", {
    p_scrape_id: scrapeId,
    p_limit: safePageSize,
    p_offset: offset,
  })
  if (error) throw error

  const rows = (data ?? []) as ScrapeContributorPageRow[]
  const contributorTotal = rows[0]?.contributor_total ?? (await getStoredContributorTotal(scrapeId, resolvedTeamId))
  const withContributions: ContributorWithContributions[] = rows.map((row) => ({
    id: row.contributor_id,
    team_id: resolvedTeamId,
    github_username: row.github_username,
    name: row.name,
    avatar_url: row.avatar_url,
    bio: row.bio,
    location: row.location,
    company: row.company,
    email: row.email,
    twitter: row.twitter,
    linkedin: row.linkedin,
    website: row.website,
    contacted: row.contacted,
    contacted_date: row.contacted_date,
    outreach_notes: row.outreach_notes,
    status: row.status,
    contributions: row.contributions,
  }))

  const hasMore = offset + rows.length < contributorTotal

  return {
    contributors: withContributions.map(toAppContributor),
    contributorTotal,
    page: safePage,
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
  },
  teamId?: string
): Promise<void> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const set: Record<string, unknown> = {}
  if (typeof updates.contacted === "boolean") set.contacted = updates.contacted
  if (updates.contacted_date !== undefined) set.contacted_date = updates.contacted_date
  if (updates.outreach_notes !== undefined) {
    set.outreach_notes = updates.outreach_notes
    set.outreach_notes_updated_at = new Date().toISOString()
  }
  if (updates.status !== undefined) set.status = updates.status
  if (Object.keys(set).length === 0) return
  set.updated_at = new Date().toISOString()

  const { error } = await supabaseAdmin
    .from("contributors")
    .update(set)
    .eq("team_id", resolvedTeamId)
    .eq("github_username", githubUsername)
  if (error) throw error
}

export type ContributorProfile = {
  id: string
  username: string
  name: string
  avatar: string
  bio: string | null
  location: string | null
  company: string | null
  contacts: {
    email?: string
    twitter?: string
    linkedin?: string
    website?: string
    github: string
  }
  notes: string | null
  notesUpdatedAt: string | null
  reminder: {
    note: string | null
    date: string | null
    updatedAt: string | null
  }
  createdAt: string | null
  updatedAt: string | null
  projects: Array<{ id: string; name: string }>
  sources: Array<{
    scrapeId: string
    target: string
    type: string
    status: string
    contributions: number
    startedAt: string | null
    completedAt: string | null
    projects: Array<{ id: string; name: string }>
  }>
}

export type ProjectListSummary = {
  id: string
  projectId: string
  name: string
  contributorCount: number
  contributorIds: string[]
  createdAt: string
  updatedAt: string
}

type ContributorProfileScrapeLink = {
  scrape_id: string
  contributor_id: string
  contributions: number
}

type ContributorProfileScrape = {
  id: string
  target: string
  type: string
  status: string
  started_at: string | null
  completed_at: string | null
}

type ContributorProfileProjectLink = {
  ecosystem_id: string
  scrape_id: string
}

export async function getContributorProfile(id: string, teamId?: string): Promise<ContributorProfile | null> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data: contributor, error: contributorError } = await supabaseAdmin
    .from("contributors")
    .select(
      "id, team_id, github_username, name, avatar_url, bio, location, company, email, twitter, linkedin, website, outreach_notes, outreach_notes_updated_at, reminder_note, reminder_date, reminder_updated_at, created_at, updated_at"
    )
    .eq("id", id)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (contributorError) throw contributorError
  if (!contributor) return null

  const row = contributor as ContributorRow
  const { data: links, error: linkError } = await supabaseAdmin
    .from("scrape_contributors")
    .select("scrape_id, contributor_id, contributions")
    .eq("contributor_id", id)
    .order("contributions", { ascending: false })
  if (linkError) throw linkError

  const scrapeLinks = (links ?? []) as ContributorProfileScrapeLink[]
  const scrapeIds = Array.from(new Set(scrapeLinks.map((link) => link.scrape_id)))
  const scrapesById = new Map<string, ContributorProfileScrape>()
  if (scrapeIds.length > 0) {
    const { data: scrapes, error: scrapeError } = await supabaseAdmin
      .from("scrapes")
      .select("id, target, type, status, started_at, completed_at")
      .eq("team_id", resolvedTeamId)
      .in("id", scrapeIds)
    if (scrapeError) throw scrapeError
    for (const scrape of (scrapes ?? []) as ContributorProfileScrape[]) {
      scrapesById.set(scrape.id, scrape)
    }
  }

  const validScrapeIds = scrapeIds.filter((scrapeId) => scrapesById.has(scrapeId))
  const projectLinksByScrapeId = new Map<string, Array<{ id: string; name: string }>>()
  const projectMap = new Map<string, { id: string; name: string }>()
  if (validScrapeIds.length > 0) {
    const { data: projectLinks, error: projectLinkError } = await supabaseAdmin
      .from("ecosystem_scrapes")
      .select("ecosystem_id, scrape_id")
      .eq("team_id", resolvedTeamId)
      .in("scrape_id", validScrapeIds)
    if (projectLinkError) throw projectLinkError

    const projectLinkRows = (projectLinks ?? []) as ContributorProfileProjectLink[]
    const projectIds = Array.from(new Set(projectLinkRows.map((link) => link.ecosystem_id)))
    if (projectIds.length > 0) {
      const { data: projects, error: projectError } = await supabaseAdmin
        .from("ecosystems")
        .select("id, name")
        .eq("team_id", resolvedTeamId)
        .in("id", projectIds)
      if (projectError) throw projectError
      for (const project of projects ?? []) {
        projectMap.set(project.id, { id: project.id, name: project.name })
      }
    }

    for (const link of projectLinkRows) {
      const project = projectMap.get(link.ecosystem_id)
      if (!project) continue
      const current = projectLinksByScrapeId.get(link.scrape_id) ?? []
      current.push(project)
      projectLinksByScrapeId.set(link.scrape_id, current)
    }
  }

  const sources = scrapeLinks
    .map((link) => {
      const scrape = scrapesById.get(link.scrape_id)
      if (!scrape) return null
      return {
        scrapeId: scrape.id,
        target: scrape.target,
        type: scrape.type,
        status: scrape.status,
        contributions: link.contributions,
        startedAt: scrape.started_at,
        completedAt: scrape.completed_at,
        projects: projectLinksByScrapeId.get(scrape.id) ?? [],
      }
    })
    .filter((source): source is ContributorProfile["sources"][number] => source !== null)

  return {
    id: row.id,
    username: row.github_username,
    name: row.name ?? row.github_username,
    avatar: row.avatar_url ?? "",
    bio: row.bio,
    location: row.location,
    company: row.company,
    contacts: {
      email: row.email ?? undefined,
      twitter: row.twitter ?? undefined,
      linkedin: row.linkedin ?? undefined,
      website: row.website ?? undefined,
      github: `https://github.com/${row.github_username}`,
    },
    notes: row.outreach_notes,
    notesUpdatedAt: row.outreach_notes_updated_at ?? null,
    reminder: {
      note: row.reminder_note ?? null,
      date: row.reminder_date ?? null,
      updatedAt: row.reminder_updated_at ?? null,
    },
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    projects: Array.from(projectMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
    sources,
  }
}

export async function updateContributorProfile(
  id: string,
  updates: {
    notes?: string | null
    linkedin?: string | null
    reminderNote?: string | null
    reminderDate?: string | null
  },
  teamId?: string
): Promise<void> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const now = new Date().toISOString()
  const set: Record<string, unknown> = {}
  if (updates.notes !== undefined) {
    set.outreach_notes = updates.notes
    set.outreach_notes_updated_at = now
  }
  if (updates.linkedin !== undefined) set.linkedin = updates.linkedin
  if (updates.reminderNote !== undefined || updates.reminderDate !== undefined) {
    if (updates.reminderNote !== undefined) set.reminder_note = updates.reminderNote
    if (updates.reminderDate !== undefined) set.reminder_date = updates.reminderDate
    set.reminder_updated_at = now
  }
  if (Object.keys(set).length === 0) return
  set.updated_at = now

  const { error } = await supabaseAdmin.from("contributors").update(set).eq("id", id).eq("team_id", resolvedTeamId)
  if (error) throw error
}

export async function deleteScrape(id: string, teamId?: string): Promise<void> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data: scrape, error: fetchError } = await supabaseAdmin
    .from("scrapes")
    .select("id")
    .eq("id", id)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (fetchError) throw fetchError
  if (!scrape) return

  const { data: affectedProjectLinks, error: affectedProjectError } = await supabaseAdmin
    .from("ecosystem_scrapes")
    .select("ecosystem_id")
    .eq("scrape_id", id)
    .eq("team_id", resolvedTeamId)
  if (affectedProjectError) throw affectedProjectError

  const { error: linkError } = await supabaseAdmin.from("scrape_contributors").delete().eq("scrape_id", id)
  if (linkError) throw linkError
  const { error: scrapeError } = await supabaseAdmin.from("scrapes").delete().eq("id", id).eq("team_id", resolvedTeamId)
  if (scrapeError) throw scrapeError

  const affectedProjectIds = Array.from(new Set((affectedProjectLinks ?? []).map((link) => link.ecosystem_id)))
  await Promise.all(
    affectedProjectIds.map((ecosystemId) => recomputeEcosystemContributorsCache(ecosystemId, resolvedTeamId))
  )
}

// ─── Shared scrapes ───────────────────────────────────────────────────────────
// Requires: CREATE TABLE shared_scrapes (
//   id TEXT PRIMARY KEY,
//   scrape_id TEXT REFERENCES scrapes(id) ON DELETE CASCADE,
//   created_at TIMESTAMPTZ DEFAULT NOW()
// );

/** Insert a share row and return the token. */
export async function createSharedScrape(scrapeId: string, token: string, teamId?: string): Promise<void> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data: scrape, error: scrapeError } = await supabaseAdmin
    .from("scrapes")
    .select("id")
    .eq("id", scrapeId)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (scrapeError) throw scrapeError
  if (!scrape) throw new Error("Scrape not found")

  const { error } = await supabaseAdmin
    .from("shared_scrapes")
    .insert({ id: token, scrape_id: scrapeId, team_id: resolvedTeamId })
  if (error) throw error
}

// ─── Ecosystems ───────────────────────────────────────────────────────────────
// Requires the migrations in the user's instructions.

export type EcosystemSummary = {
  id: string
  name: string
  createdAt: string
  scrapeCount: number
  contributorCount: number
  lastActivityAt: string | null
}

export type EcosystemDetail = {
  id: string
  name: string
  createdAt: string
  scrapes: Array<{ id: string; target: string; type: string; completedAt: string; contributorCount: number }>
}

export type EcosystemContributor = {
  id: string
  username: string
  name: string
  avatar: string
  scrapeCount: number
  scrapeTargets: string[]
  totalContributions: number
  contacts: { email?: string; twitter?: string; linkedin?: string; website?: string }
}

export type EcosystemContributorCacheStatus = "hit" | "rebuilt" | "bypassed"

export type EcosystemContributorCache = {
  contributors: EcosystemContributor[]
  contributorCount: number
  multiRepoCount: number
  scrapeIds: string[]
  recomputedAt: string | null
  cacheStatus: EcosystemContributorCacheStatus
}

type EcosystemContributorCacheSource = {
  scrapeIds: string[]
  totalScrapeContributors: number
  latestScrapeCompletedAt: string | null
}

export async function createEcosystem(name: string, teamId?: string): Promise<EcosystemSummary> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data, error } = await supabaseAdmin
    .from("ecosystems")
    .insert({ name, team_id: resolvedTeamId })
    .select("*")
    .single()
  if (error) throw error
  return { id: data.id, name: data.name, createdAt: data.created_at, scrapeCount: 0, contributorCount: 0, lastActivityAt: null }
}

export async function getEcosystems(teamId?: string): Promise<EcosystemSummary[]> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data: ecosystems, error } = await supabaseAdmin
    .from("ecosystems")
    .select("*")
    .eq("team_id", resolvedTeamId)
    .order("created_at", { ascending: false })
  if (error) throw error
  if (!ecosystems?.length) return []

  const { data: links, error: linkError } = await supabaseAdmin
    .from("ecosystem_scrapes")
    .select("ecosystem_id, scrape_id")
    .eq("team_id", resolvedTeamId)
    .in("ecosystem_id", ecosystems.map((e) => e.id))
  if (linkError) throw linkError

  const countMap = new Map<string, number>()
  const scrapeIdsByEcosystem = new Map<string, string[]>()
  for (const l of links ?? []) {
    countMap.set(l.ecosystem_id, (countMap.get(l.ecosystem_id) ?? 0) + 1)
    const scrapeIds = scrapeIdsByEcosystem.get(l.ecosystem_id) ?? []
    scrapeIds.push(l.scrape_id)
    scrapeIdsByEcosystem.set(l.ecosystem_id, scrapeIds)
  }

  const scrapeIds = Array.from(new Set((links ?? []).map((l) => l.scrape_id)))
  const scrapeMetaById = new Map<string, { totalContributors: number; activityAt: string | null }>()
  if (scrapeIds.length > 0) {
    const { data: scrapeRows, error: scrapeError } = await supabaseAdmin
      .from("scrapes")
      .select("id, total_contributors, completed_at, started_at")
      .eq("team_id", resolvedTeamId)
      .in("id", scrapeIds)
    if (scrapeError) throw scrapeError
    for (const scrape of scrapeRows ?? []) {
      scrapeMetaById.set(scrape.id, {
        totalContributors: scrape.total_contributors ?? 0,
        activityAt: scrape.completed_at ?? scrape.started_at ?? null,
      })
    }
  }

  return ecosystems.map((e) => ({
    id: e.id,
    name: e.name,
    createdAt: e.created_at,
    scrapeCount: countMap.get(e.id) ?? 0,
    contributorCount: (scrapeIdsByEcosystem.get(e.id) ?? []).reduce(
      (sum, scrapeId) => sum + (scrapeMetaById.get(scrapeId)?.totalContributors ?? 0),
      0
    ),
    lastActivityAt: (scrapeIdsByEcosystem.get(e.id) ?? []).reduce<string | null>((latest, scrapeId) => {
      const activityAt = scrapeMetaById.get(scrapeId)?.activityAt ?? null
      if (!activityAt) return latest
      return !latest || new Date(activityAt).getTime() > new Date(latest).getTime() ? activityAt : latest
    }, null),
  }))
}

export async function getEcosystem(id: string, teamId?: string): Promise<EcosystemDetail | null> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data: eco, error } = await supabaseAdmin
    .from("ecosystems")
    .select("*")
    .eq("id", id)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (error) throw error
  if (!eco) return null

  const { data: links } = await supabaseAdmin
    .from("ecosystem_scrapes")
    .select("scrape_id")
    .eq("ecosystem_id", id)
    .eq("team_id", resolvedTeamId)

  const scrapeIds = (links ?? []).map((l) => l.scrape_id)
  if (!scrapeIds.length) return { id: eco.id, name: eco.name, createdAt: eco.created_at, scrapes: [] }

  type ScrapeMeta = {
    id: string
    target: string
    type: string
    completed_at: string | null
    total_contributors: number | null
  }
  const scrapeRows: ScrapeMeta[] = []
  for (let i = 0; i < scrapeIds.length; i += 50) {
    const batch = scrapeIds.slice(i, i + 50)
    const { data: batchRows, error: sErr } = await supabaseAdmin
      .from("scrapes")
      .select("id, target, type, completed_at, total_contributors")
      .eq("team_id", resolvedTeamId)
      .in("id", batch)
    if (sErr) throw sErr
    scrapeRows.push(...((batchRows ?? []) as ScrapeMeta[]))
  }

  const byId = new Map(scrapeRows.map((s) => [s.id, s]))
  const ordered = scrapeIds.map((sid) => byId.get(sid)).filter((s): s is ScrapeMeta => s != null)

  return {
    id: eco.id,
    name: eco.name,
    createdAt: eco.created_at,
    scrapes: ordered.map((s) => ({
      id: s.id,
      target: s.target,
      type: s.type,
      completedAt: s.completed_at ?? "",
      contributorCount: s.total_contributors ?? 0,
    })),
  }
}

export async function ecosystemExists(id: string, teamId?: string): Promise<boolean> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data, error } = await supabaseAdmin
    .from("ecosystems")
    .select("id")
    .eq("id", id)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (error) throw error
  return Boolean(data)
}

export async function addScrapeToEcosystem(
  ecosystemId: string,
  scrapeId: string,
  teamId?: string
): Promise<void> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data: ecosystem, error: ecosystemError } = await supabaseAdmin
    .from("ecosystems")
    .select("id")
    .eq("id", ecosystemId)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (ecosystemError) throw ecosystemError
  if (!ecosystem) throw new Error("Ecosystem not found")

  const { data: scrape, error: scrapeError } = await supabaseAdmin
    .from("scrapes")
    .select("id")
    .eq("id", scrapeId)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (scrapeError) throw scrapeError
  if (!scrape) throw new Error("Scrape not found")

  const { error } = await supabaseAdmin
    .from("ecosystem_scrapes")
    .insert({ ecosystem_id: ecosystemId, scrape_id: scrapeId, team_id: resolvedTeamId })
  if (error) throw error
  await recomputeEcosystemContributorsCache(ecosystemId, resolvedTeamId)
}

export async function removeScrapeFromEcosystem(
  ecosystemId: string,
  scrapeId: string,
  teamId?: string
): Promise<void> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { error } = await supabaseAdmin
    .from("ecosystem_scrapes")
    .delete()
    .eq("ecosystem_id", ecosystemId)
    .eq("scrape_id", scrapeId)
    .eq("team_id", resolvedTeamId)
  if (error) throw error
  await recomputeEcosystemContributorsCache(ecosystemId, resolvedTeamId)
}

export async function deleteEcosystem(id: string, teamId?: string): Promise<void> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { error } = await supabaseAdmin.from("ecosystems").delete().eq("id", id).eq("team_id", resolvedTeamId)
  if (error) throw error
}

export async function getProjectLists(ecosystemId: string, teamId?: string): Promise<ProjectListSummary[]> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const exists = await ecosystemExists(ecosystemId, resolvedTeamId)
  if (!exists) throw new Error("Project not found")

  const { data: lists, error } = await supabaseAdmin
    .from("project_lists")
    .select("id, ecosystem_id, name, created_at, updated_at")
    .eq("team_id", resolvedTeamId)
    .eq("ecosystem_id", ecosystemId)
    .order("created_at", { ascending: false })
  if (error) throw error
  if (!lists?.length) return []

  const { data: links, error: linkError } = await supabaseAdmin
    .from("project_list_contributors")
    .select("project_list_id, contributor_id")
    .eq("team_id", resolvedTeamId)
    .in("project_list_id", lists.map((list) => list.id))
  if (linkError) throw linkError

  const countMap = new Map<string, number>()
  const contributorIdsByList = new Map<string, string[]>()
  for (const link of links ?? []) {
    countMap.set(link.project_list_id, (countMap.get(link.project_list_id) ?? 0) + 1)
    const contributorIds = contributorIdsByList.get(link.project_list_id) ?? []
    contributorIds.push(link.contributor_id)
    contributorIdsByList.set(link.project_list_id, contributorIds)
  }

  return lists.map((list) => ({
    id: list.id,
    projectId: list.ecosystem_id,
    name: list.name,
    contributorCount: countMap.get(list.id) ?? 0,
    contributorIds: contributorIdsByList.get(list.id) ?? [],
    createdAt: list.created_at,
    updatedAt: list.updated_at,
  }))
}

export async function createProjectList(
  ecosystemId: string,
  name: string,
  teamId?: string
): Promise<ProjectListSummary> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const exists = await ecosystemExists(ecosystemId, resolvedTeamId)
  if (!exists) throw new Error("Project not found")

  const { data, error } = await supabaseAdmin
    .from("project_lists")
    .insert({ team_id: resolvedTeamId, ecosystem_id: ecosystemId, name })
    .select("id, ecosystem_id, name, created_at, updated_at")
    .single()
  if (error) throw error

  return {
    id: data.id,
    projectId: data.ecosystem_id,
    name: data.name,
    contributorCount: 0,
    contributorIds: [],
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }
}

export async function renameProjectList(
  ecosystemId: string,
  listId: string,
  name: string,
  teamId?: string
): Promise<ProjectListSummary> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data, error } = await supabaseAdmin
    .from("project_lists")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", listId)
    .eq("ecosystem_id", ecosystemId)
    .eq("team_id", resolvedTeamId)
    .select("id, ecosystem_id, name, created_at, updated_at")
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Project list not found")

  return {
    id: data.id,
    projectId: data.ecosystem_id,
    name: data.name,
    contributorCount: 0,
    contributorIds: [],
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }
}

export async function deleteProjectList(ecosystemId: string, listId: string, teamId?: string): Promise<void> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { error } = await supabaseAdmin
    .from("project_lists")
    .delete()
    .eq("id", listId)
    .eq("ecosystem_id", ecosystemId)
    .eq("team_id", resolvedTeamId)
  if (error) throw error
}

export async function addContributorToProjectList(
  ecosystemId: string,
  listId: string,
  contributorId: string,
  teamId?: string
): Promise<void> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data: list, error: listError } = await supabaseAdmin
    .from("project_lists")
    .select("id")
    .eq("id", listId)
    .eq("ecosystem_id", ecosystemId)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (listError) throw listError
  if (!list) throw new Error("Project list not found")

  const { data: contributor, error: contributorError } = await supabaseAdmin
    .from("contributors")
    .select("id")
    .eq("id", contributorId)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (contributorError) throw contributorError
  if (!contributor) throw new Error("Contributor not found")

  const { error } = await supabaseAdmin
    .from("project_list_contributors")
    .insert({ team_id: resolvedTeamId, project_list_id: listId, contributor_id: contributorId })
  if (error) throw error
}

export async function getEcosystemContributors(
  ecosystemId: string,
  teamId?: string
): Promise<EcosystemContributor[]> {
  const cache = await getOrRecomputeEcosystemContributors(ecosystemId, teamId)
  return cache.contributors
}

export async function getCachedEcosystemContributors(
  ecosystemId: string,
  teamId?: string
): Promise<EcosystemContributorCache | null> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const { data, error } = await supabaseAdmin
    .from("project_contributors_cache")
    .select("scrape_ids, contributors, contributor_count, multi_repo_count, recomputed_at")
    .eq("ecosystem_id", ecosystemId)
    .eq("team_id", resolvedTeamId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  return {
    contributors: Array.isArray(data.contributors) ? (data.contributors as EcosystemContributor[]) : [],
    contributorCount: data.contributor_count ?? 0,
    multiRepoCount: data.multi_repo_count ?? 0,
    scrapeIds: Array.isArray(data.scrape_ids) ? data.scrape_ids : [],
    recomputedAt: data.recomputed_at ?? null,
    cacheStatus: "hit",
  }
}

export async function getOrRecomputeEcosystemContributors(
  ecosystemId: string,
  teamId?: string
): Promise<EcosystemContributorCache> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const source = await getEcosystemContributorCacheSource(ecosystemId, resolvedTeamId)
  let cached: EcosystemContributorCache | null = null
  try {
    cached = await getCachedEcosystemContributors(ecosystemId, resolvedTeamId)
  } catch (error) {
    console.warn("[project-contributors-cache] Cache read failed; computing directly.", error)
    return computeEcosystemContributorsWithoutCache(ecosystemId, resolvedTeamId, source.scrapeIds)
  }

  if (
    cached &&
    !shouldRecomputeEcosystemContributorCache({
      cachedScrapeIds: cached.scrapeIds,
      currentScrapeIds: source.scrapeIds,
      cachedContributorCount: cached.contributorCount,
      totalScrapeContributors: source.totalScrapeContributors,
      recomputedAt: cached.recomputedAt,
      latestScrapeCompletedAt: source.latestScrapeCompletedAt,
    })
  ) {
    return cached
  }
  return recomputeEcosystemContributorsCache(ecosystemId, resolvedTeamId)
}

export async function recomputeEcosystemContributorsCache(
  ecosystemId: string,
  teamId?: string
): Promise<EcosystemContributorCache> {
  const resolvedTeamId = await resolveTeamId(teamId)
  const contributors = await computeEcosystemContributors(ecosystemId, resolvedTeamId)
  const scrapeIds = await getEcosystemScrapeIds(ecosystemId, resolvedTeamId)
  const contributorCount = contributors.length
  const multiRepoCount = contributors.filter((contributor) => contributor.scrapeCount > 1).length
  const recomputedAt = new Date().toISOString()

  const { error } = await supabaseAdmin
    .from("project_contributors_cache")
    .upsert({
      ecosystem_id: ecosystemId,
      team_id: resolvedTeamId,
      scrape_ids: scrapeIds,
      contributors,
      contributor_count: contributorCount,
      multi_repo_count: multiRepoCount,
      recomputed_at: recomputedAt,
    })
  if (error) {
    console.warn("[project-contributors-cache] Cache write failed; returning computed contributors.", error)
    return {
      contributors,
      contributorCount,
      multiRepoCount,
      scrapeIds,
      recomputedAt,
      cacheStatus: "bypassed",
    }
  }

  return {
    contributors,
    contributorCount,
    multiRepoCount,
    scrapeIds,
    recomputedAt,
    cacheStatus: "rebuilt",
  }
}

async function computeEcosystemContributorsWithoutCache(
  ecosystemId: string,
  resolvedTeamId: string,
  scrapeIds?: string[]
): Promise<EcosystemContributorCache> {
  const [contributors, resolvedScrapeIds] = await Promise.all([
    computeEcosystemContributors(ecosystemId, resolvedTeamId),
    scrapeIds ? Promise.resolve(scrapeIds) : getEcosystemScrapeIds(ecosystemId, resolvedTeamId),
  ])
  return {
    contributors,
    contributorCount: contributors.length,
    multiRepoCount: contributors.filter((contributor) => contributor.scrapeCount > 1).length,
    scrapeIds: resolvedScrapeIds,
    recomputedAt: new Date().toISOString(),
    cacheStatus: "bypassed",
  }
}

async function getEcosystemScrapeIds(ecosystemId: string, teamId: string): Promise<string[]> {
  const { data: ecoLinks, error } = await supabaseAdmin
    .from("ecosystem_scrapes")
    .select("scrape_id")
    .eq("ecosystem_id", ecosystemId)
    .eq("team_id", teamId)
  if (error) throw error
  return (ecoLinks ?? []).map((link) => link.scrape_id)
}

async function getEcosystemContributorCacheSource(
  ecosystemId: string,
  teamId: string
): Promise<EcosystemContributorCacheSource> {
  const scrapeIds = await getEcosystemScrapeIds(ecosystemId, teamId)
  if (scrapeIds.length === 0) {
    return { scrapeIds, totalScrapeContributors: 0, latestScrapeCompletedAt: null }
  }

  let totalScrapeContributors = 0
  let latestScrapeCompletedAt: string | null = null
  for (let i = 0; i < scrapeIds.length; i += 50) {
    const batch = scrapeIds.slice(i, i + 50)
    const { data: scrapeRows, error } = await supabaseAdmin
      .from("scrapes")
      .select("id, total_contributors, completed_at")
      .eq("team_id", teamId)
      .in("id", batch)
    if (error) throw error

    for (const scrape of scrapeRows ?? []) {
      totalScrapeContributors += scrape.total_contributors ?? 0
      const completedAt = scrape.completed_at ?? null
      if (completedAt && (!latestScrapeCompletedAt || new Date(completedAt) > new Date(latestScrapeCompletedAt))) {
        latestScrapeCompletedAt = completedAt
      }
    }
  }

  return { scrapeIds, totalScrapeContributors, latestScrapeCompletedAt }
}

async function computeEcosystemContributors(
  ecosystemId: string,
  resolvedTeamId: string
): Promise<EcosystemContributor[]> {
  const { data: ecoLinks, error: elErr } = await supabaseAdmin
    .from("ecosystem_scrapes")
    .select("scrape_id")
    .eq("ecosystem_id", ecosystemId)
    .eq("team_id", resolvedTeamId)
  if (elErr) throw elErr
  if (!ecoLinks?.length) return []

  const scrapeIds = ecoLinks.map((l) => l.scrape_id)

  const targetMap = new Map<string, string>()
  for (let i = 0; i < scrapeIds.length; i += 50) {
    const batch = scrapeIds.slice(i, i + 50)
    const { data: scrapeRows, error: sErr } = await supabaseAdmin
      .from("scrapes")
      .select("id, target")
      .eq("team_id", resolvedTeamId)
      .in("id", batch)
    if (sErr) throw sErr
    for (const r of scrapeRows ?? []) targetMap.set(r.id, r.target as string)
  }

  const linkResults = await Promise.all(
    scrapeIds.map((scrapeId) =>
      supabaseAdmin
        .from("scrape_contributors")
        .select("scrape_id, contributor_id, contributions")
        .eq("scrape_id", scrapeId)
    )
  )
  const allLinks: Array<{ scrape_id: string; contributor_id: string; contributions: number }> = []
  for (const { data: rows, error: linksErr } of linkResults) {
    if (linksErr) throw linksErr
    allLinks.push(...((rows ?? []) as Array<{ scrape_id: string; contributor_id: string; contributions: number }>))
  }

  if (!allLinks.length) return []

  const contributorIds = Array.from(new Set(allLinks.map((link) => link.contributor_id)))
  const contributors: ContributorRow[] = []
  for (let i = 0; i < contributorIds.length; i += 50) {
    const batch = contributorIds.slice(i, i + 50)
    const { data: batchRows, error: cErr } = await supabaseAdmin
      .from("contributors")
      .select("*")
      .eq("team_id", resolvedTeamId)
      .in("id", batch)
    if (cErr) throw cErr
    contributors.push(...(batchRows ?? []))
  }

  return aggregateEcosystemContributors(contributors, allLinks, targetMap)
}

/** Resolve a share token → full scrape with contributors, or null if not found. */
export async function getSharedScrape(token: string): Promise<AppScrape | null> {
  const { data: share, error: shareError } = await supabaseAdmin
    .from("shared_scrapes")
    .select("scrape_id, team_id")
    .eq("id", token)
    .maybeSingle()
  if (shareError) throw shareError
  if (!share) return null
  return getScrape(share.scrape_id, share.team_id)
}
