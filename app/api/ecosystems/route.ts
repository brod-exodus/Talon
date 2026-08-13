import { type NextRequest, NextResponse } from "next/server"
import { recordActivityEvent } from "@/lib/activity"
import { getEcosystems, createEcosystem } from "@/lib/db"
import { requirePermission } from "@/lib/permissions"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeName, readJsonObject } from "@/lib/validation"

export async function GET(request: NextRequest) {
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const ecosystems = await getEcosystems(teamId)
    return NextResponse.json(ecosystems)
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[ecosystems] GET error:", error)
    return NextResponse.json({ error: "Failed to fetch projects" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await requirePermission(request, "write")
  if (authError) return authError

  try {
    const { teamId, email } = await resolveTeamContext(request)
    const body = await readJsonObject(request)
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    const normalizedName = normalizeName(body.name)
    if (!normalizedName) {
      return NextResponse.json({ error: "Missing or invalid name" }, { status: 400 })
    }
    const ecosystem = await createEcosystem(normalizedName, teamId)
    await recordActivityEvent({
      teamId,
      actorEmail: email,
      type: "project.created",
      title: "Project created",
      description: normalizedName,
      metadata: { projectId: ecosystem.id, name: ecosystem.name },
    })
    return NextResponse.json(ecosystem)
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error)
    console.error("[ecosystems] POST error:", error)
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Project already exists" }, { status: 409 })
    }
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 })
  }
}
