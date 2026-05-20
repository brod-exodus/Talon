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

type AuthUserSummary = {
  id: string
  email?: string | null
  email_confirmed_at?: string | null
  confirmed_at?: string | null
}

type AuthStatus = "active" | "unconfirmed" | "missing"

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

function getAuthStatus(user: AuthUserSummary | null): AuthStatus {
  if (!user) return "missing"
  return user.email_confirmed_at || user.confirmed_at ? "active" : "unconfirmed"
}

function mapTeamMember(row: TeamMemberRow, authUser: AuthUserSummary | null = null) {
  return {
    id: row.id,
    teamId: row.team_id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    authStatus: getAuthStatus(authUser),
  }
}

async function listAuthUsersByEmail(): Promise<Map<string, AuthUserSummary>> {
  const usersByEmail = new Map<string, AuthUserSummary>()
  let page = 1
  while (page <= 10) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    for (const user of data.users ?? []) {
      if (user.email) usersByEmail.set(user.email.toLowerCase(), user as AuthUserSummary)
    }
    if ((data.users ?? []).length < 1000) return usersByEmail
    page += 1
  }
  return usersByEmail
}

async function findAuthUserByEmail(email: string): Promise<AuthUserSummary | null> {
  const usersByEmail = await listAuthUsersByEmail()
  return usersByEmail.get(email) ?? null
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

    const authUsersByEmail = await listAuthUsersByEmail()
    return NextResponse.json({
      members: (data ?? []).map((row) => {
        const member = row as TeamMemberRow
        return mapTeamMember(member, authUsersByEmail.get(member.email.toLowerCase()) ?? null)
      }),
    })
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
    const authUser = await findAuthUserByEmail(email)
    let nextAuthUser = authUser
    let authUserCreated = false
    let authUserUpdated = false

    if (!authUser) {
      if (!password) {
        return NextResponse.json({ error: "A temporary password of at least 8 characters is required for new users" }, { status: 400 })
      }

      const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (createError) throw createError
      nextAuthUser = createdUser.user as AuthUserSummary
      authUserCreated = true
    } else if (password || getAuthStatus(authUser) === "unconfirmed") {
      const { data: updatedUser, error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        ...(password ? { password } : {}),
        email_confirm: true,
      })
      if (updateError) throw updateError
      nextAuthUser = updatedUser.user as AuthUserSummary
      authUserUpdated = true
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
      metadata: { teamSlug: team.teamSlug, role, emailHash: hashAuditValue(email), authUserCreated, authUserUpdated },
    })

    return NextResponse.json({
      member: mapTeamMember(data as TeamMemberRow, nextAuthUser),
      authUserCreated,
      authUserUpdated,
    })
  } catch (error) {
    console.error("[team-members] POST error:", error)
    return NextResponse.json({ error: "Failed to save team member" }, { status: 500 })
  }
}
