import { createSupabaseClient } from "./supabase/server"

export type ScrapeData = {
  id: string
  type: "organization" | "repository"
  target: string
  role?: string
  status: "active" | "completed" | "failed"
  progress: number
  current: number
  total: number
  currentUser?: string
  startedAt: Date
  completedAt?: Date
  contributors: Array<{
    username: string
    name: string
    avatar: string
    contributions: number
    bio?: string
    location?: string
    company?: string
    contacts: {
      email?: string
      twitter?: string
      linkedin?: string
      website?: string
    }
    contacted?: boolean
    contactedDate?: string
    contactedMethod?: string
    contactedNotes?: string
  }>
  error?: string
}

// Database helper functions
export async function getScrape(id: string): Promise<ScrapeData | null> {
  const supabase = await createSupabaseClient()

  const { data: scrape, error } = await supabase.from("scrapes").select("*").eq("id", id).single()

  if (error || !scrape) return null

  const { data: contributors } = await supabase.from("contributors").select("*").eq("scrape_id", id)

  return {
    id: scrape.id,
    type: scrape.type,
    target: scrape.name,
    role: scrape.role || undefined,
    status: scrape.status,
    progress: Math.round((scrape.current / scrape.total) * 100),
    current: scrape.current,
    total: scrape.total,
    startedAt: new Date(scrape.started_at),
    completedAt: scrape.completed_at ? new Date(scrape.completed_at) : undefined,
    contributors: (contributors || []).map((c) => ({
      username: c.login,
      name: c.name || c.login,
      avatar: c.avatar_url,
      contributions: c.contributions,
      contacted: c.contacted,
      contactedDate: c.contacted_date || undefined,
      contactedMethod: c.contacted_method || undefined,
      contactedNotes: c.contacted_notes || undefined,
      contacts: {},
    })),
  }
}

export async function createScrape(scrape: Omit<ScrapeData, "contributors">): Promise<void> {
  const supabase = await createSupabaseClient()

  await supabase.from("scrapes").insert({
    id: scrape.id,
    type: scrape.type,
    name: scrape.target,
    url: `https://github.com/${scrape.target}`,
    status: scrape.status,
    current: scrape.current,
    total: scrape.total,
    role: scrape.role || null,
    started_at: scrape.startedAt.toISOString(),
  })
}

export async function updateScrape(
  id: string,
  updates: Partial<Omit<ScrapeData, "id" | "contributors">>,
): Promise<void> {
  const supabase = await createSupabaseClient()

  const dbUpdates: Record<string, unknown> = {}
  if (updates.status) dbUpdates.status = updates.status
  if (updates.current !== undefined) dbUpdates.current = updates.current
  if (updates.total !== undefined) dbUpdates.total = updates.total
  if (updates.completedAt) dbUpdates.completed_at = updates.completedAt.toISOString()
  if (updates.role !== undefined) dbUpdates.role = updates.role

  await supabase.from("scrapes").update(dbUpdates).eq("id", id)
}

export async function addContributor(scrapeId: string, contributor: ScrapeData["contributors"][0]): Promise<void> {
  const supabase = await createSupabaseClient()

  await supabase.from("contributors").insert({
    id: `${scrapeId}-${contributor.username}`,
    scrape_id: scrapeId,
    login: contributor.username,
    name: contributor.name,
    avatar_url: contributor.avatar,
    html_url: `https://github.com/${contributor.username}`,
    contributions: contributor.contributions,
    contacted: contributor.contacted || false,
    contacted_date: contributor.contactedDate || null,
    contacted_method: contributor.contactedMethod || null,
    contacted_notes: contributor.contactedNotes || null,
  })
}

export async function getAllScrapes(): Promise<{
  active: Array<Omit<ScrapeData, "contributors">>
  completed: ScrapeData[]
}> {
  try {
    const supabase = await createSupabaseClient()

    const { data: scrapes, error } = await supabase
      .from("scrapes")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("[v0] Database error:", error)
      return { active: [], completed: [] }
    }

    if (!scrapes) return { active: [], completed: [] }

    const active: Array<Omit<ScrapeData, "contributors">> = []
    const completed: ScrapeData[] = []

    for (const scrape of scrapes) {
      const scrapeData: Omit<ScrapeData, "contributors"> = {
        id: scrape.id,
        type: scrape.type,
        target: scrape.name,
        role: scrape.role || undefined,
        status: scrape.status,
        progress: scrape.total > 0 ? Math.round((scrape.current / scrape.total) * 100) : 0,
        current: scrape.current,
        total: scrape.total,
        startedAt: new Date(scrape.started_at),
        completedAt: scrape.completed_at ? new Date(scrape.completed_at) : undefined,
      }

      if (scrape.status === "active") {
        active.push(scrapeData)
      } else if (scrape.status === "completed") {
        const { data: contributors } = await supabase.from("contributors").select("*").eq("scrape_id", scrape.id)

        completed.push({
          ...scrapeData,
          contributors: (contributors || []).map((c) => ({
            username: c.login,
            name: c.name || c.login,
            avatar: c.avatar_url,
            contributions: c.contributions,
            contacted: c.contacted,
            contactedDate: c.contacted_date || undefined,
            contactedMethod: c.contacted_method || undefined,
            contactedNotes: c.contacted_notes || undefined,
            contacts: {},
          })),
        })
      }
    }

    return { active, completed }
  } catch (error) {
    console.error("[v0] getAllScrapes error:", error)
    return { active: [], completed: [] }
  }
}

export async function deleteScrape(id: string): Promise<void> {
  const supabase = await createSupabaseClient()
  await supabase.from("scrapes").delete().eq("id", id)
}

export async function updateContributorOutreach(
  scrapeId: string,
  username: string,
  outreach: {
    contacted: boolean
    contactedDate?: string
    contactedMethod?: string
    contactedNotes?: string
  },
): Promise<void> {
  const supabase = await createSupabaseClient()

  await supabase
    .from("contributors")
    .update({
      contacted: outreach.contacted,
      contacted_date: outreach.contactedDate || null,
      contacted_method: outreach.contactedMethod || null,
      contacted_notes: outreach.contactedNotes || null,
    })
    .eq("id", `${scrapeId}-${username}`)
}

export async function getRoles(): Promise<string[]> {
  const supabase = await createSupabaseClient()
  const { data } = await supabase.from("roles").select("name").order("created_at")
  return (data || []).map((r) => r.name)
}

export async function addRole(name: string): Promise<void> {
  const supabase = await createSupabaseClient()
  await supabase.from("roles").insert({
    id: `role-${Date.now()}`,
    name,
  })
}

export async function deleteRole(name: string): Promise<void> {
  const supabase = await createSupabaseClient()
  await supabase.from("roles").delete().eq("name", name)
}

export async function updateRole(oldName: string, newName: string): Promise<void> {
  const supabase = await createSupabaseClient()

  // Update role name
  await supabase.from("roles").update({ name: newName }).eq("name", oldName)

  // Update all scrapes with this role
  await supabase.from("scrapes").update({ role: newName }).eq("role", oldName)
}
