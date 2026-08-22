import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { recordActivityEvent } from "@/lib/activity"
import { getEcosystems, createEcosystem } from "@/lib/db"
import { logError } from "@/lib/logger"
import { requirePermission } from "@/lib/permissions"
import { getRequestId } from "@/lib/request-id"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeName, readJsonObject } from "@/lib/validation"

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  try {
    const { teamId } = await resolveTeamContext(request)
    const ecosystems = await getEcosystems(teamId)
    return NextResponse.json(ecosystems)
  } catch (error) {
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    logError("ecosystems.list_failed", error, { requestId })
    return internalErrorResponse("ecosystems_read_failed", requestId)
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
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
    if (error instanceof Error && error.message.includes("Default team is missing")) return teamContextError(error, requestId)
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "Project already exists" }, { status: 409 })
    }
    logError("ecosystems.create_failed", error, { requestId })
    return internalErrorResponse("ecosystem_create_failed", requestId)
  }
}
