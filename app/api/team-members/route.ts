import { type NextRequest, NextResponse } from "next/server"
import { getAuthSession } from "@/lib/auth"
import { recordAuditEvent, hashAuditValue } from "@/lib/audit"
import { requirePermission } from "@/lib/permissions"
import { type AuthRole } from "@/lib/permission-rules"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { readJsonObject } from "@/lib/validation"

const ROLES: AuthRole[] = ["owner", "admin", "recruiter", "viewer"]
const PASSWORD_MIN_LENGTH = 8

type TeamMemberRow = {
  id: string
  team_id: string
  email: string
  role: AuthRole
  invited_by: string | null
  created_at: string
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const email = value.trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null
}

function normalizeRole(value: unknown): AuthRole | null {
  return typeof value === "string" && ROLES.includes(value as AuthRole) ? (value as AuthRole) : null
}

function normalizePassword(value: unknown): string | null {
  if (typeof value !== "string") return null
  const password = value.trim()
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= 128 ? password : null
}

function mapTeamMember(row: TeamMemberRow) {
  return {
    id: row.id,
    teamId: row.team_id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
  }
}

async function findAuthUserByEmail(email: string): Promise<boolean> {
  let page = 1
  while (page <= 10) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    if ((data.users ?? []).some((user) => user.email?.toLowerCase() === email)) return true
    if ((data.users ?? []).length < 1000) return false
    page += 1
  }
  return false
}

export async function GET(request: NextRequest) {
  const authError = requirePermission(request, "admin")
  if (authError) return authError

  try {
    const team = await resolveTeamContext(request)
    const { data, error } = await supabaseAdmin
      .from("team_memberships")
      .select("id, team_id, email, role, invited_by, created_at")
      .eq("team_id", team.teamId)
      .order("created_at", { ascending: true })
    if (error) throw error

    return NextResponse.json({ members: (data ?? []).map((row) => mapTeamMember(row as TeamMemberRow)) })
  } catch (error) {
    return teamContextError(error)
  }
}

export async function POST(request: NextRequest) {
  const authError = requirePermission(request, "admin")
  if (authError) return authError

  try {
    const body = await readJsonObject(request)
    const email = normalizeEmail(body?.email)
    const role = normalizeRole(body?.role)
    const password = normalizePassword(body?.password)

    if (!email) return NextResponse.json({ error: "Invalid email" }, { status: 400 })
    if (!role) return NextResponse.json({ error: "Invalid role" }, { status: 400 })

    const team = await resolveTeamContext(request)
    const session = getAuthSession(request)
    const actorEmail = session?.actor === "user" ? session.email : "admin"
    const authUserExists = await findAuthUserByEmail(email)

    if (!authUserExists) {
      if (!password) {
        return NextResponse.json({ error: "A temporary password of at least 8 characters is required for new users" }, { status: 400 })
      }

      const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (createError) throw createError
    }

    const { data, error } = await supabaseAdmin
      .from("team_memberships")
      .upsert(
        {
          team_id: team.teamId,
          email,
          role,
          invited_by: actorEmail,
        },
        { onConflict: "team_id,email" }
      )
      .select("id, team_id, email, role, invited_by, created_at")
      .single()
    if (error) throw error

    await recordAuditEvent({
      request,
      action: "team.member.upsert",
      outcome: "success",
      actor: team.actor,
      metadata: { teamSlug: team.teamSlug, role, emailHash: hashAuditValue(email), authUserCreated: !authUserExists },
    })

    return NextResponse.json({ member: mapTeamMember(data as TeamMemberRow), authUserCreated: !authUserExists })
  } catch (error) {
    console.error("[team-members] POST error:", error)
    return NextResponse.json({ error: "Failed to save team member" }, { status: 500 })
  }
}
