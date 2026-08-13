import { type NextRequest, NextResponse } from "next/server"
import { recordAuditEvent, hashAuditValue } from "@/lib/audit"
import { requirePermission } from "@/lib/permissions"
import { type AuthRole } from "@/lib/permission-rules"
import { supabaseAdmin } from "@/lib/supabase"
import { resolveTeamContext, teamContextError } from "@/lib/team-context"
import { normalizeUuid, readJsonObject } from "@/lib/validation"

const ROLES: AuthRole[] = ["owner", "admin", "recruiter", "viewer"]

type TeamMemberRow = {
  id: string
  team_id: string
  email: string
  display_name: string | null
  role: AuthRole
  app_role: AuthRole | null
  invited_by: string | null
  created_at: string
}

type AuthUserSummary = {
  email?: string | null
  email_confirmed_at?: string | null
  confirmed_at?: string | null
}

type AuthStatus = "active" | "unconfirmed" | "missing"

function normalizeRole(value: unknown): AuthRole | null {
  return typeof value === "string" && ROLES.includes(value as AuthRole) ? (value as AuthRole) : null
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
    displayName: row.display_name,
    role: row.app_role ?? row.role,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    authStatus: getAuthStatus(authUser),
  }
}

async function findAuthUserByEmail(email: string): Promise<AuthUserSummary | null> {
  let page = 1
  while (page <= 10) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const user = (data.users ?? []).find((item) => item.email?.toLowerCase() === email.toLowerCase())
    if (user) return user as AuthUserSummary
    if ((data.users ?? []).length < 1000) return null
    page += 1
  }
  return null
}

async function getTeamMembers(teamId: string): Promise<TeamMemberRow[]> {
  const { data, error } = await supabaseAdmin
    .from("team_memberships")
    .select("id, team_id, email, display_name, role, app_role, invited_by, created_at")
    .eq("team_id", teamId)
  if (error) throw error
  return (data ?? []) as TeamMemberRow[]
}

function isLastOwner(members: TeamMemberRow[], targetId: string): boolean {
  const target = members.find((member) => member.id === targetId)
  if (target?.role !== "owner") return false
  return members.filter((member) => member.role === "owner").length <= 1
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requirePermission(request, "admin")
  if (authError) return authError

  try {
    const { id } = await params
    const memberId = normalizeUuid(id)
    if (!memberId) return NextResponse.json({ error: "Invalid member id" }, { status: 400 })

    const body = await readJsonObject(request)
    const role = normalizeRole(body?.role)
    if (!role) return NextResponse.json({ error: "Invalid role" }, { status: 400 })

    const team = await resolveTeamContext(request)
    const members = await getTeamMembers(team.teamId)
    const target = members.find((member) => member.id === memberId)
    if (!target) return NextResponse.json({ error: "Team member not found" }, { status: 404 })
    const { data, error } = await supabaseAdmin
      .from("team_memberships")
      .update({ app_role: role })
      .eq("id", memberId)
      .eq("team_id", team.teamId)
      .select("id, team_id, email, display_name, role, app_role, invited_by, created_at")
      .single()
    if (error) throw error

    await recordAuditEvent({
      request,
      action: "team.member.update_role",
      outcome: "success",
      actor: team.actor,
      teamId: team.teamId,
      metadata: { teamSlug: team.teamSlug, role, emailHash: hashAuditValue(target.email) },
    })

    const authUser = await findAuthUserByEmail(target.email)
    return NextResponse.json({ member: mapTeamMember(data as TeamMemberRow, authUser) })
  } catch (error) {
    console.error("[team-members] PATCH error:", error)
    if (error instanceof Error && (error.message.includes("Default team is missing") || error.message.includes("not a member"))) {
      return teamContextError(error)
    }
    return NextResponse.json({ error: "Failed to update team member" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requirePermission(request, "admin")
  if (authError) return authError

  try {
    const { id } = await params
    const memberId = normalizeUuid(id)
    if (!memberId) return NextResponse.json({ error: "Invalid member id" }, { status: 400 })

    const team = await resolveTeamContext(request)
    const members = await getTeamMembers(team.teamId)
    const target = members.find((member) => member.id === memberId)
    if (!target) return NextResponse.json({ error: "Team member not found" }, { status: 404 })
    if (isLastOwner(members, memberId)) {
      return NextResponse.json({ error: "At least one owner must remain on the team" }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from("team_memberships")
      .delete()
      .eq("id", memberId)
      .eq("team_id", team.teamId)
    if (error) throw error

    await recordAuditEvent({
      request,
      action: "team.member.remove",
      outcome: "success",
      actor: team.actor,
      teamId: team.teamId,
      metadata: { teamSlug: team.teamSlug, role: target.app_role ?? target.role, emailHash: hashAuditValue(target.email) },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[team-members] DELETE error:", error)
    if (error instanceof Error && (error.message.includes("Default team is missing") || error.message.includes("not a member"))) {
      return teamContextError(error)
    }
    return NextResponse.json({ error: "Failed to remove team member" }, { status: 500 })
  }
}
