export type Permission = "read" | "write" | "admin"
export type AuthRole = "owner" | "admin" | "recruiter" | "viewer"
export type AuthSession =
  | {
      version: 1
      actor: "admin"
      expiresAt: number
    }
  | {
      version: 1
      actor: "user"
      email: string
      teamId: string
      teamSlug: string
      role: AuthRole
      expiresAt: number
    }

const ROLE_PERMISSIONS: Record<AuthRole, Permission[]> = {
  owner: ["read", "write", "admin"],
  admin: ["read", "write", "admin"],
  recruiter: ["read", "write"],
  viewer: ["read"],
}

export function roleHasPermission(role: AuthRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function sessionHasPermission(session: AuthSession | null, permission: Permission): boolean {
  if (!session) return false
  if (session.actor === "admin") return true
  return roleHasPermission(session.role, permission)
}
