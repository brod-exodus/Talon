import { supabaseAdmin } from "@/lib/supabase"

export type ActivityEventType =
  | "scrape.started"
  | "scrape.completed"
  | "watched_repo.added"
  | "watched_repo.contributors_found"
  | "project.created"

export type ActivityEvent = {
  id: string
  type: ActivityEventType
  title: string
  description: string | null
  href: string
  metadata: Record<string, unknown>
  createdAt: string
}

type ActivityEventRow = {
  id: string
  type: ActivityEventType
  title: string
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

function activityHref(type: ActivityEventType, metadata: Record<string, unknown>): string {
  if (type === "project.created" && typeof metadata.projectId === "string") {
    return `/ecosystems/${metadata.projectId}`
  }
  if (type === "watched_repo.added" || type === "watched_repo.contributors_found") return "/watched"
  return "/"
}

function toActivityEvent(row: ActivityEventRow): ActivityEvent {
  const metadata = row.metadata ?? {}
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    href: activityHref(row.type, metadata),
    metadata,
    createdAt: row.created_at,
  }
}

export async function recordActivityEvent({
  teamId,
  actorEmail,
  type,
  title,
  description = null,
  metadata = {},
}: {
  teamId: string
  actorEmail?: string | null
  type: ActivityEventType
  title: string
  description?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("activity_events").insert({
      team_id: teamId,
      actor_email: actorEmail ?? null,
      type,
      title,
      description,
      metadata,
    })
    if (error) throw error
  } catch (error) {
    console.warn("[activity] Failed to record activity event:", error)
  }
}

export async function getRecentActivityEvents(teamId: string, limit = 10): Promise<ActivityEvent[]> {
  const { data, error } = await supabaseAdmin
    .from("activity_events")
    .select("id, type, title, description, metadata, created_at")
    .eq("team_id", teamId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 10)))
  if (error) throw error
  return ((data ?? []) as ActivityEventRow[]).map(toActivityEvent)
}
