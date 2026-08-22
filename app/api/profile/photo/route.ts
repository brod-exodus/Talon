import { createHash, randomUUID } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"
import { internalErrorResponse } from "@/lib/api-error-response"
import { requirePermission } from "@/lib/permissions"
import { getAuthSession } from "@/lib/auth"
import { hashAuditValue, recordAuditEvent } from "@/lib/audit"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { logError } from "@/lib/logger"
import { getRequestId } from "@/lib/request-id"

const AVATAR_BUCKET = "team-avatars"
const MAX_AVATAR_BYTES = 2 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
])

type ProfilePhotoRow = {
  avatar_path: string | null
}

function hashEmailPath(email: string): string {
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24)
}

function profilePhotoMigrationError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42703"
  )
}

async function getCurrentPhotoPath(teamId: string, email: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("team_memberships")
    .select("avatar_path")
    .eq("team_id", teamId)
    .eq("email", email)
    .maybeSingle()
  if (error) throw error
  return (data as ProfilePhotoRow | null)?.avatar_path ?? null
}

function photoStorageNotReady() {
  return NextResponse.json(
    { error: "Profile photo storage is not ready. Apply db/migrations/012_team_profile_photos.sql." },
    { status: 500 }
  )
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  const session = getAuthSession(request)
  if (session?.actor !== "user") {
    return NextResponse.json({ error: "Profile photos are available for team user accounts." }, { status: 403 })
  }

  try {
    const team = await resolveTeamContext(request)
    const formData = await request.formData()
    const photo = formData.get("photo")

    if (!(photo instanceof File)) {
      return NextResponse.json({ error: "Upload a profile photo file." }, { status: 400 })
    }
    if (photo.size <= 0) {
      return NextResponse.json({ error: "Profile photo cannot be empty." }, { status: 400 })
    }
    if (photo.size > MAX_AVATAR_BYTES) {
      return NextResponse.json({ error: "Profile photo must be 2MB or smaller." }, { status: 400 })
    }

    const extension = ALLOWED_IMAGE_TYPES.get(photo.type)
    if (!extension) {
      return NextResponse.json({ error: "Profile photo must be a JPEG, PNG, or WebP image." }, { status: 400 })
    }

    let oldPath: string | null = null
    try {
      oldPath = await getCurrentPhotoPath(team.teamId, session.email)
    } catch (error) {
      if (profilePhotoMigrationError(error)) return photoStorageNotReady()
      throw error
    }

    const path = `${team.teamId}/${hashEmailPath(session.email)}/${randomUUID()}.${extension}`
    const { error: uploadError } = await supabaseAdmin.storage
      .from(AVATAR_BUCKET)
      .upload(path, photo, {
        contentType: photo.type,
        upsert: false,
      })
    if (uploadError) throw uploadError

    const { data: publicUrlData } = supabaseAdmin.storage.from(AVATAR_BUCKET).getPublicUrl(path)
    const avatarUrl = publicUrlData.publicUrl

    const { error: updateError } = await supabaseAdmin
      .from("team_memberships")
      .update({
        avatar_path: path,
        avatar_url: avatarUrl,
        profile_updated_at: new Date().toISOString(),
      })
      .eq("team_id", team.teamId)
      .eq("email", session.email)
    if (updateError) {
      await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([path])
      if (profilePhotoMigrationError(updateError)) return photoStorageNotReady()
      throw updateError
    }

    if (oldPath && oldPath !== path) {
      await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([oldPath])
    }

    await recordAuditEvent({
      request,
      action: "profile.photo.update",
      outcome: "success",
      actor: "user",
      teamId: team.teamId,
      metadata: { teamSlug: team.teamSlug, emailHash: hashAuditValue(session.email) },
    })

    return NextResponse.json({ avatarUrl })
  } catch (error) {
    if (error instanceof Error && (error.message.includes("Default team is missing") || error.message.includes("not a member"))) {
      return teamContextError(error, requestId)
    }
    logError("profile.photo_upload_failed", error, { requestId })
    return internalErrorResponse("profile_photo_upload_failed", requestId)
  }
}

export async function DELETE(request: NextRequest) {
  const requestId = getRequestId(request)
  const authError = await requirePermission(request, "read")
  if (authError) return authError

  const session = getAuthSession(request)
  if (session?.actor !== "user") {
    return NextResponse.json({ error: "Profile photos are available for team user accounts." }, { status: 403 })
  }

  try {
    const team = await resolveTeamContext(request)
    let oldPath: string | null = null
    try {
      oldPath = await getCurrentPhotoPath(team.teamId, session.email)
    } catch (error) {
      if (profilePhotoMigrationError(error)) return photoStorageNotReady()
      throw error
    }

    const { error } = await supabaseAdmin
      .from("team_memberships")
      .update({
        avatar_path: null,
        avatar_url: null,
        profile_updated_at: new Date().toISOString(),
      })
      .eq("team_id", team.teamId)
      .eq("email", session.email)
    if (error) {
      if (profilePhotoMigrationError(error)) return photoStorageNotReady()
      throw error
    }

    if (oldPath) {
      await supabaseAdmin.storage.from(AVATAR_BUCKET).remove([oldPath])
    }

    await recordAuditEvent({
      request,
      action: "profile.photo.remove",
      outcome: "success",
      actor: "user",
      teamId: team.teamId,
      metadata: { teamSlug: team.teamSlug, emailHash: hashAuditValue(session.email) },
    })

    return NextResponse.json({ avatarUrl: null })
  } catch (error) {
    if (error instanceof Error && (error.message.includes("Default team is missing") || error.message.includes("not a member"))) {
      return teamContextError(error, requestId)
    }
    logError("profile.photo_remove_failed", error, { requestId })
    return internalErrorResponse("profile_photo_remove_failed", requestId)
  }
}
