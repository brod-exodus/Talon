import { type NextRequest, NextResponse } from "next/server"
import { getContributorProfile, updateContributorProfile } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeOptionalIsoDate, normalizeOptionalNotes, normalizeUuid, readJsonObject } from "@/lib/validation"

type RouteContext = {
  params: Promise<{ id: string }>
}

type ContributorProfileResponse = Awaited<ReturnType<typeof getContributorProfile>>

function normalizeOptionalUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value == null || value === "") return null
  if (typeof value !== "string") return undefined
  const raw = value.trim()
  if (!raw) return null
  if (raw.length > 2048) return undefined
  try {
    const url = new URL(raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { id } = await context.params
    const contributorId = normalizeUuid(id)
    if (!contributorId) return NextResponse.json({ error: "Invalid contributor id" }, { status: 400 })

    const { teamId } = await resolveTeamContext(request)
    const contributor = await getContributorProfile(contributorId, teamId)
    if (!contributor) return NextResponse.json({ error: "Contributor not found" }, { status: 404 })
    if (request.nextUrl.searchParams.get("preview") === "1") {
      return NextResponse.json({ contributor: toContributorPreview(contributor) })
    }
    return NextResponse.json({ contributor })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    console.error("[contributors/[id]] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch contributor" }, { status: 500 })
  }
}

function toContributorPreview(contributor: NonNullable<ContributorProfileResponse>) {
  return {
    id: contributor.id,
    username: contributor.username,
    name: contributor.name,
    avatar: contributor.avatar,
    bio: contributor.bio,
    location: contributor.location,
    company: contributor.company,
    contacts: contributor.contacts,
    projects: contributor.projects,
    sources: contributor.sources.map((source) => ({
      scrapeId: source.scrapeId,
      target: source.target,
      type: source.type,
      status: source.status,
      contributions: source.contributions,
      projects: source.projects,
    })),
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { id } = await context.params
    const contributorId = normalizeUuid(id)
    if (!contributorId) return NextResponse.json({ error: "Invalid contributor id" }, { status: 400 })

    const body = await readJsonObject(request)
    if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })

    const notes = normalizeOptionalNotes(body.notes)
    const reminderNote = normalizeOptionalNotes(body.reminderNote)
    const reminderDate = normalizeOptionalIsoDate(body.reminderDate)
    const linkedin = normalizeOptionalUrl(body.linkedin)

    if (body.notes !== undefined && notes === undefined) {
      return NextResponse.json({ error: "Invalid notes" }, { status: 400 })
    }
    if (body.reminderNote !== undefined && reminderNote === undefined) {
      return NextResponse.json({ error: "Invalid reminder note" }, { status: 400 })
    }
    if (body.reminderDate !== undefined && reminderDate === undefined) {
      return NextResponse.json({ error: "Invalid reminder date" }, { status: 400 })
    }
    if (body.linkedin !== undefined && linkedin === undefined) {
      return NextResponse.json({ error: "Invalid LinkedIn URL" }, { status: 400 })
    }

    const { teamId } = await resolveTeamContext(request)
    await updateContributorProfile(
      contributorId,
      {
        notes: body.notes !== undefined ? notes ?? null : undefined,
        reminderNote: body.reminderNote !== undefined ? reminderNote ?? null : undefined,
        reminderDate: body.reminderDate !== undefined ? reminderDate ?? null : undefined,
        linkedin: body.linkedin !== undefined ? linkedin ?? null : undefined,
      },
      teamId
    )
    const contributor = await getContributorProfile(contributorId, teamId)
    if (!contributor) return NextResponse.json({ error: "Contributor not found" }, { status: 404 })
    return NextResponse.json({ contributor })
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    if (error instanceof Error && error.message.includes("not a member")) return teamContextError(error)
    console.error("[contributors/[id]] PATCH error:", error)
    return NextResponse.json({ error: "Failed to update contributor" }, { status: 500 })
  }
}
